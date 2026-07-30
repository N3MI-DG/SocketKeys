/**
 * Connection lifecycle for the single Moonraker websocket.
 *
 * Module-scoped reactive state acts as a singleton store — ES modules are
 * cached, so every importer shares one instance without a state library.
 *
 * This module stays feature-agnostic: it knows nothing about printer objects.
 * Consumers register for the notifications they care about via
 * `onNotification`, and watch `connectionState.status` for lifecycle changes.
 */

import { reactive } from "vue";
import { JsonRpcClient, type ReadyState } from "./client";
import { settingsState } from "../settings";
import type { ServerInfoResult } from "./types";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/** Mirrors Moonraker's own `klippy_state` values (see `ServerInfoResult`).
 *  `null` means "not connected to Moonraker, so unknown" — distinct from
 *  Moonraker's own "disconnected" (connected to Moonraker, but Klipper isn't
 *  reachable from it). */
export type KlippyState =
  | "ready"
  | "startup"
  | "shutdown"
  | "error"
  | "disconnected"
  | null;

export const connectionState = reactive({
  status: "disconnected" as ConnectionStatus,
  address: "",
  error: null as string | null,
  /** `http://host:port` (or `https://`) for the connected printer — Moonraker
   *  serves file content (e.g. logs) over plain HTTP, not the websocket. */
  httpBaseUrl: "",
  /** Klipper's own state, as last reported by Moonraker — independent of the
   *  websocket connection, since Klipper can restart/shut down while
   *  Moonraker stays up and connected. */
  klippyState: null as KlippyState,
});

const DEFAULT_PORT = 7125;
const CLIENT_NAME = "SocketKeys";
const CLIENT_VERSION = "0.1.0";

/** Delay between automatic reconnect attempts — fixed rather than backed
 *  off, since `settingsState.reconnectDurationS` already bounds how long
 *  this can go on for. */
const RECONNECT_RETRY_DELAY_MS = 3000;

let client: JsonRpcClient | null = null;
let intentionalClose = false;

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** Epoch ms the current reconnect window gives up — `null` when not
 *  reconnecting. Plain module state, not on `connectionState`: nothing
 *  reactive needs to read it, only `runReconnectAttempt` below. */
let reconnectDeadline: number | null = null;

function clearReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDeadline = null;
}

// A method can have more than one subscriber (e.g. both objectStore and this
// module itself react to `notify_klippy_ready`), so each entry is a list.
const notifyHandlers = new Map<string, Array<(params: unknown) => void>>();

/** Register a handler for a server notification method (e.g. `notify_status_update`). */
export function onNotification(
  method: string,
  handler: (params: unknown) => void,
): void {
  const handlers = notifyHandlers.get(method);
  if (handlers) handlers.push(handler);
  else notifyHandlers.set(method, [handler]);
}

export function getClient(): JsonRpcClient | null {
  return client;
}

interface ParsedAddress {
  /** Websocket scheme — "wss" only if the user explicitly typed https/wss. */
  wsScheme: "ws" | "wss";
  host: string;
  port: number;
}

/**
 * Parses user input into host/port/scheme, shared by the websocket URL and
 * the HTTP base URL (Moonraker serves both from the same host:port).
 * Accepts `192.168.1.50`, `printer.local:7125`, `http://host/`, `[::1]:7125`.
 */
function parseAddress(raw: string): ParsedAddress {
  let input = raw.trim();
  if (!input) throw new Error("Enter a printer address");

  let wsScheme: "ws" | "wss" = "ws";
  const schemeMatch = /^(wss|ws|https|http):\/\//i.exec(input);
  if (schemeMatch) {
    const found = schemeMatch[1].toLowerCase();
    wsScheme = found === "https" || found === "wss" ? "wss" : "ws";
    input = input.slice(schemeMatch[0].length);
  }

  // Any path the user pasted is discarded; Moonraker always lives at /websocket.
  input = input.split("/")[0];
  if (!input) throw new Error("Enter a printer address");

  let host = input;
  let port = DEFAULT_PORT;

  // Bracketed IPv6 keeps its colons; everything else splits on the last one.
  const bracketEnd = input.startsWith("[") ? input.indexOf("]") : -1;
  if (bracketEnd !== -1) {
    host = input.slice(0, bracketEnd + 1);
    const rest = input.slice(bracketEnd + 1);
    if (rest.startsWith(":")) port = parsePort(rest.slice(1));
    else if (rest) throw new Error(`Invalid address "${raw.trim()}"`);
  } else {
    const colon = input.lastIndexOf(":");
    if (colon !== -1) {
      host = input.slice(0, colon);
      port = parsePort(input.slice(colon + 1));
    }
  }

  if (!host) throw new Error("Enter a printer address");
  return { wsScheme, host, port };
}

/** Turn user input into a Moonraker websocket URL. */
export function buildWebsocketUrl(raw: string): string {
  const { wsScheme, host, port } = parseAddress(raw);
  return `${wsScheme}://${host}:${port}/websocket`;
}

/** Turn user input into an HTTP base URL for the same printer, e.g. for
 *  fetching file content (`${httpBaseUrl}/server/files/logs/klippy.log`). */
export function buildHttpBaseUrl(raw: string): string {
  const { wsScheme, host, port } = parseAddress(raw);
  return `${wsScheme === "wss" ? "https" : "http"}://${host}:${port}`;
}

/** Just the host portion of the current connection, with no port — the
 *  substitution value for the `*addr*` placeholder web panels can use in
 *  their address (see webPanels.ts). Only meaningful once connected, at
 *  which point `connectionState.address` is guaranteed to be a
 *  previously-parsed-successfully address. */
export function connectedHost(): string {
  return parseAddress(connectionState.address).host;
}

function parsePort(text: string): number {
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port "${text}"`);
  }
  return parsed;
}

interface ConnectAttemptResult {
  ok: boolean;
  error?: string;
}

/**
 * The actual handshake — socket open + identify — shared by an explicit
 * `connect()` call and each automatic reconnect attempt. Deliberately
 * doesn't touch `connectionState.status` except on success ("connected" is
 * unambiguous regardless of who called this); failure handling differs
 * between the two callers, so it's left to them via the returned result.
 */
async function attemptConnection(rawAddress: string): Promise<ConnectAttemptResult> {
  let url: string;
  try {
    url = buildWebsocketUrl(rawAddress);
    connectionState.httpBaseUrl = buildHttpBaseUrl(rawAddress);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  connectionState.address = rawAddress.trim();
  intentionalClose = false;

  const active: JsonRpcClient = new JsonRpcClient(url, {
    onNotify: handleNotify,
    onStateChange: (state) => handleStateChange(active, state),
  });
  client = active;

  try {
    await active.connect();
  } catch (err) {
    if (client === active) client = null;
    connectionState.httpBaseUrl = "";
    connectionState.klippyState = null;
    return { ok: false, error: describeConnectError(err, url) };
  }

  // Identify is optional when Moonraker has no auth configured, so a failure
  // here shouldn't block an otherwise working connection.
  try {
    await active.call("server.connection.identify", {
      client_name: CLIENT_NAME,
      version: CLIENT_VERSION,
      type: "desktop",
      url: "",
    });
  } catch (err) {
    console.warn("[moonraker] identify failed, continuing anyway", err);
  }

  // Best-effort: gives an immediate klippyState instead of waiting on the
  // next notify_klippy_* event, which may be a long time coming if Klipper
  // is already sitting in "shutdown"/"error" when we connect.
  try {
    const info = await active.call<ServerInfoResult>("server.info");
    if (client === active) connectionState.klippyState = parseKlippyState(info);
  } catch (err) {
    console.warn("[moonraker] server.info failed, continuing anyway", err);
  }

  // Guard against being superseded (e.g. disconnected) while identify was
  // in flight — handleStateChange already nulled `client` in that case.
  if (client !== active) return { ok: false };
  connectionState.status = "connected";
  connectionState.error = null;
  clearReconnect();
  return { ok: true };
}

const KNOWN_KLIPPY_STATES = ["ready", "startup", "shutdown", "error", "disconnected"];

function parseKlippyState(info: ServerInfoResult | undefined): KlippyState {
  const state = info?.klippy_state;
  return KNOWN_KLIPPY_STATES.includes(state as string) ? (state as KlippyState) : null;
}

export async function connect(rawAddress: string): Promise<void> {
  clearReconnect();
  if (client) disconnect();

  connectionState.status = "connecting";
  connectionState.error = null;

  const result = await attemptConnection(rawAddress);
  if (!result.ok) {
    connectionState.status = "error";
    connectionState.error = result.error ?? "Could not connect";
    connectionState.httpBaseUrl = "";
    connectionState.klippyState = null;
  }
}

export function disconnect(): void {
  clearReconnect();
  intentionalClose = true;
  const active = client;
  client = null;
  active?.close();
  intentionalClose = false;

  connectionState.status = "disconnected";
  connectionState.error = null;
  connectionState.httpBaseUrl = "";
  connectionState.klippyState = null;
}

/**
 * Kicks off automatic retries after an unexpected drop, per
 * `settingsState.reconnectDurationS` (0 disables this — same "Connection
 * lost" error as before this feature existed).
 */
function startReconnect(): void {
  const durationS = settingsState.reconnectDurationS;
  if (!durationS) {
    connectionState.status = "error";
    connectionState.error = "Connection lost";
    connectionState.httpBaseUrl = "";
    connectionState.klippyState = null;
    return;
  }

  connectionState.status = "reconnecting";
  connectionState.error = "Connection lost — Reconnecting…";
  reconnectDeadline = Date.now() + durationS * 1000;
  reconnectTimer = setTimeout(() => void runReconnectAttempt(), 0);
}

async function runReconnectAttempt(): Promise<void> {
  reconnectTimer = null;
  // Superseded by a manual connect()/disconnect() while this was scheduled.
  if (connectionState.status !== "reconnecting") return;

  const result = await attemptConnection(connectionState.address);
  if (result.ok) return; // attemptConnection already moved to "connected"

  // Same check again: attemptConnection awaits, during which the user could
  // have clicked Connect/Disconnect and taken this out of "reconnecting".
  if (connectionState.status !== "reconnecting") return;

  if (reconnectDeadline !== null && Date.now() >= reconnectDeadline) {
    connectionState.status = "error";
    connectionState.error = "Could not reconnect";
    connectionState.httpBaseUrl = "";
    connectionState.klippyState = null;
    reconnectDeadline = null;
    return;
  }
  reconnectTimer = setTimeout(() => void runReconnectAttempt(), RECONNECT_RETRY_DELAY_MS);
}

function handleStateChange(source: JsonRpcClient, state: ReadyState): void {
  if (state !== "closed") return;
  if (source !== client) return; // superseded client shutting down
  if (intentionalClose) return; // user pressed Disconnect

  client = null;
  // A failure during connect()/a reconnect attempt is reported by its own
  // caller, with a better message — only a drop from a steady "connected"
  // state starts the reconnect loop.
  if (connectionState.status === "connected") startReconnect();
}

function handleNotify(method: string, params: unknown): void {
  // Moonraker emits many notifications v1 ignores; unknown ones are a no-op.
  for (const handler of notifyHandlers.get(method) ?? []) handler(params);
}

onNotification("notify_klippy_ready", () => {
  connectionState.klippyState = "ready";
});
onNotification("notify_klippy_shutdown", () => {
  connectionState.klippyState = "shutdown";
});
onNotification("notify_klippy_disconnected", () => {
  connectionState.klippyState = "disconnected";
});

function describeConnectError(err: unknown, url: string): string {
  const detail = err instanceof Error ? err.message : String(err);
  if (detail.includes("timed out")) return `Timed out connecting to ${url}`;
  // Browsers deliberately withhold the real reason for a failed handshake.
  return `Could not connect to ${url}`;
}
