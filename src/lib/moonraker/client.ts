/**
 * Minimal JSON-RPC 2.0 client over a plain WebSocket.
 *
 * Deliberately Vue-agnostic: this is transport only, so it can be reasoned
 * about (and driven by a fake socket) without mounting anything. Reconnection
 * policy lives a layer up in connection.ts.
 */

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
  private ws: WebSocket | null = null;
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
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch (err) {
        this.setState("closed");
        reject(new Error(`Invalid address: ${String(err)}`));
        return;
      }

      this.ws = socket;
      this.connectSettled = false;
      this.setState("connecting");

      // WebSocket has no built-in connect timeout, so race it manually.
      const timer = setTimeout(() => {
        if (this.connectSettled) return;
        this.connectSettled = true;
        this.detach(socket);
        socket.close();
        this.ws = null;
        this.failAll(new Error("Connection timed out"));
        this.setState("closed");
        reject(new Error("Connection timed out"));
      }, CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        if (this.connectSettled) return;
        this.connectSettled = true;
        clearTimeout(timer);
        this.setState("open");
        resolve();
      };

      socket.onmessage = (event) => this.handleMessage(event);

      // onerror carries no useful detail in browsers; onclose always follows.
      socket.onerror = () => {};

      socket.onclose = () => {
        clearTimeout(timer);
        const settled = this.connectSettled;
        this.connectSettled = true;
        if (this.ws === socket) this.ws = null;
        this.failAll(new Error("Connection closed"));
        this.setState("closed");
        if (!settled) reject(new Error("Could not connect"));
      };
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

      try {
        socket.send(
          JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {}, id }),
        );
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`Failed to send "${method}": ${String(err)}`));
      }
    });
  }

  close(): void {
    const socket = this.ws;
    this.ws = null;
    this.failAll(new Error("Connection closed"));
    if (socket) {
      // Detach first so our own close doesn't look like a dropped connection.
      this.detach(socket);
      socket.close();
    }
    this.setState("closed");
  }

  private handleMessage(event: MessageEvent): void {
    let message: unknown;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : "");
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

  private detach(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
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
