/**
 * Recently-used printer addresses, most recent first, capped at
 * `MAX_ENTRIES` — feeds the titlebar's address input: autofill with the
 * last one on launch, full list as suggestions on focus.
 *
 * Watches `connectionState` itself (like logs.ts does for its own reset)
 * rather than connection.ts calling into this module, so connection.ts stays
 * feature-agnostic per its own docstring — recording history is a UI
 * concern, not a connection-lifecycle one.
 */
import { reactive, watch } from "vue";
import { connectionState } from "./moonraker/connection";

const STORAGE_KEY = "socketkeys.recentConnections.v1";
const MAX_ENTRIES = 10;

function loadPersisted(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return []; // malformed storage — start clean rather than crash
  }
}

export const recentConnections = reactive<string[]>(loadPersisted());

watch(
  () => [...recentConnections],
  (list) => localStorage.setItem(STORAGE_KEY, JSON.stringify(list)),
);

/** Moves `address` to the front, deduping rather than repeating it, and
 *  trims back to `MAX_ENTRIES`. */
function rememberConnection(address: string): void {
  const trimmed = address.trim();
  if (!trimmed) return;
  const existing = recentConnections.indexOf(trimmed);
  if (existing !== -1) recentConnections.splice(existing, 1);
  recentConnections.unshift(trimmed);
  recentConnections.length = Math.min(recentConnections.length, MAX_ENTRIES);
}

watch(
  () => connectionState.status,
  (status) => {
    if (status === "connected") rememberConnection(connectionState.address);
  },
);
