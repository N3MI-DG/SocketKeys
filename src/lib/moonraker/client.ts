/**
 * Minimal JSON-RPC 2.0 client over a Tauri-native WebSocket.
 *
 * Uses `@tauri-apps/plugin-websocket` (a Rust/tokio socket bridged over IPC)
 * rather than the browser's own `WebSocket`, since the webview's network
 * stack enforces browser-only restrictions (mixed content, an Origin header
 * Moonraker's CORS check may not trust) that don't apply to a printer's
 * plain `ws://` endpoint on the local network.
 *
 * Deliberately Vue-agnostic: this is transport only, so it can be reasoned
 * about (and driven by a fake socket) without mounting anything. Reconnection
 * policy lives a layer up in connection.ts.
 */

import TauriWebSocket, { type Message } from "@tauri-apps/plugin-websocket";

export type ReadyState = "connecting" | "open" | "closed";

export interface JsonRpcClientOptions {
  /** Called for every server-initiated message (no `id`), e.g. `notify_*`. */
  onNotify?: (method: string, params: unknown) => void;
  onStateChange?: (state: ReadyState) => void;
}

const CONNECT_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_MS = 10000;

interface PendingCall {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class JsonRpcClient {
  private ws: TauriWebSocket | null = null;
  private unlisten: (() => void) | null = null;
  private state: ReadyState = "closed";
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private connectSettled = false;

  constructor(
    private readonly url: string,
    private readonly options: JsonRpcClientOptions = {},
  ) {}

  get readyState(): ReadyState {
    return this.state;
  }

  /** Resolves once the socket is open; rejects on failure or timeout. */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectSettled = false;
      this.setState("connecting");

      const timer = setTimeout(() => {
        if (this.connectSettled) return;
        this.connectSettled = true;
        const socket = this.ws;
        this.ws = null;
        this.detach();
        void socket?.disconnect();
        this.failAll(new Error("Connection timed out"));
        this.setState("closed");
        reject(new Error("Connection timed out"));
      }, CONNECT_TIMEOUT_MS);

      TauriWebSocket.connect(this.url)
        .then((socket) => {
          if (this.connectSettled) {
            // Timed out while connect() was still in flight.
            void socket.disconnect();
            return;
          }
          this.connectSettled = true;
          clearTimeout(timer);
          this.ws = socket;
          this.unlisten = socket.addListener((msg) =>
            this.handleMessage(socket, msg),
          );
          this.setState("open");
          resolve();
        })
        .catch((err) => {
          if (this.connectSettled) return;
          this.connectSettled = true;
          clearTimeout(timer);
          this.ws = null;
          this.failAll(new Error("Connection closed"));
          this.setState("closed");
          reject(new Error(`Could not connect: ${String(err)}`));
        });
    });
  }

  call<T = unknown>(
    method: string,
    params?: object,
    timeoutMs: number = CALL_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const socket = this.ws;
      if (!socket || this.state !== "open") {
        reject(new Error("Not connected"));
        return;
      }

      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request "${method}" timed out`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as PendingCall["resolve"],
        reject,
        timer,
      });

      socket
        .send(JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {}, id }))
        .catch((err) => {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`Failed to send "${method}": ${String(err)}`));
        });
    });
  }

  close(): void {
    const socket = this.ws;
    this.ws = null;
    this.failAll(new Error("Connection closed"));
    if (socket) {
      // Detach first so our own close doesn't look like a dropped connection.
      this.detach();
      void socket.disconnect();
    }
    this.setState("closed");
  }

  /** `socket` identifies which connection this came from, so a stale/
   *  superseded socket's close can't be mistaken for the live one's. */
  private handleMessage(socket: TauriWebSocket, msg: Message): void {
    if (msg.type === "Close") {
      if (this.ws !== socket) return; // already superseded
      this.ws = null;
      this.detach();
      this.failAll(new Error("Connection closed"));
      this.setState("closed");
      return;
    }

    if (msg.type !== "Text") return; // Moonraker only sends text JSON-RPC frames

    let message: unknown;
    try {
      message = JSON.parse(msg.data);
    } catch {
      // One malformed frame must never take down the socket.
      console.warn("[moonraker] dropped malformed frame");
      return;
    }

    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;

    if (typeof record.id === "number") {
      const pending = this.pending.get(record.id);
      // No entry means it already timed out — drop it.
      if (!pending) return;
      this.pending.delete(record.id);
      clearTimeout(pending.timer);

      const error = record.error as { message?: string } | undefined;
      if (error) {
        pending.reject(new Error(error.message ?? "JSON-RPC error"));
      } else {
        (pending.resolve as (value: unknown) => void)(record.result);
      }
      return;
    }

    if (typeof record.method === "string") {
      this.options.onNotify?.(record.method, record.params);
    }
  }

  private detach(): void {
    this.unlisten?.();
    this.unlisten = null;
  }

  /** Nothing may stay pending across a close, or callers hang forever. */
  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private setState(state: ReadyState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}
