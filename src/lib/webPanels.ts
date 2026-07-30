/**
 * User-defined web panels — arbitrary bookmarked URLs (Mainsail, a webcam
 * page, Home Assistant, ...), each rendered the same way by WebPanel.vue.
 * Every entry here becomes its own selectable frame — see frames.ts, which
 * merges this list into `FRAMES`.
 *
 * "Web Interface" (id "web") — the connected printer's own UI — is not a
 * separate built-in case anymore: it's just the one entry pre-seeded below,
 * removable like any other. What used to be special-cased connection-aware
 * behavior is now the `*addr*` placeholder any panel's address can use.
 */
import { reactive, watch } from "vue";

export interface WebPanelDef {
  id: string;
  name: string;
  address: string;
}

const STORAGE_KEY = "socketkeys.webPanels.v1";
/** Sentinel: has the one-time default-panel seed (see loadPersisted) ever
 *  run? Deliberately separate from STORAGE_KEY being unset — "web" used to
 *  be hardcoded elsewhere and never actually lived in that key, so anyone
 *  who already had *any* persisted web panels (even zero, or one they'd
 *  added while testing) would otherwise never get seeded and silently lose
 *  "Web Interface" for good. Once this has run once, a later deliberate
 *  removal of "web" is respected rather than being re-added forever. */
const SEEDED_KEY = "socketkeys.webPanels.seededDefault.v1";

/**
 * Stands in for the connected printer's host (no port, no scheme) in a
 * panel's address — e.g. "*addr*:8080" or "https://*addr*, webcam path
 * appended". A panel using it waits for a connection the same way the old
 * built-in one did; one that doesn't is just a bookmark, shown regardless
 * of connection state. See resolveWebPanelUrl / usesConnectedAddress.
 */
export const ADDR_PLACEHOLDER = "*addr*";

/** Only used to seed a fresh install/migration (see loadPersisted) — kept
 *  as its own id/name so a pre-existing default-frame setting pointing at
 *  "web" (from before user-removable web panels existed) still resolves
 *  correctly. */
const DEFAULT_WEB_PANEL: WebPanelDef = { id: "web", name: "", address: ADDR_PLACEHOLDER };

function isWebPanelDef(value: unknown): value is WebPanelDef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    v.name.length > 0 &&
    typeof v.address === "string" &&
    v.address.length > 0
  );
}

function loadPersisted(): WebPanelDef[] {
  let list: WebPanelDef[];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown);
    list = Array.isArray(parsed) ? parsed.filter(isWebPanelDef) : [];
  } catch {
    list = []; // malformed storage — start clean rather than crash
  }

  if (localStorage.getItem(SEEDED_KEY) === null) {
    if (!list.some((panel) => panel.id === DEFAULT_WEB_PANEL.id)) {
      list = [{ ...DEFAULT_WEB_PANEL }, ...list];
      // Written immediately, not left to the watcher below — otherwise a
      // session that never mutates webPanels again would lose this on the
      // next launch, since SEEDED_KEY (now set) would block it from ever
      // running again.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
    localStorage.setItem(SEEDED_KEY, "true");
  }

  return list;
}

export const webPanels = reactive<WebPanelDef[]>(loadPersisted());

watch(
  () => [...webPanels],
  (list) => localStorage.setItem(STORAGE_KEY, JSON.stringify(list)),
);

export function getWebPanel(id: string): WebPanelDef | undefined {
  return webPanels.find((panel) => panel.id === id);
}

/** Adds a panel and returns its generated id, so the caller can select it
 *  as a frame right away instead of leaving the user to hunt for it. */
export function addWebPanel(name: string, address: string): string {
  const id = `webpanel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  webPanels.push({ id, name: name.trim(), address: address.trim() });
  return id;
}

export function removeWebPanel(id: string): void {
  const index = webPanels.findIndex((panel) => panel.id === id);
  if (index !== -1) webPanels.splice(index, 1);
}

/** Replaces the whole entry at `id` (rather than mutating its fields in
 *  place) so the persistence watcher below — which only tracks the array's
 *  own shape, not each panel's inner fields — actually notices the change. */
export function updateWebPanel(id: string, name: string, address: string): void {
  const index = webPanels.findIndex((panel) => panel.id === id);
  if (index === -1) return;
  webPanels[index] = { id, name: name.trim(), address: address.trim() };
}

export function usesConnectedAddress(address: string): boolean {
  return address.includes(ADDR_PLACEHOLDER);
}

/**
 * Substitutes `*addr*` with `connectedHost` and defaults to http:// when no
 * scheme was typed — these are free-typed bookmarks, not Moonraker
 * addresses, so (unlike connection.ts) no host/port parsing, just whatever
 * was entered passed straight through, including any path.
 *
 * Returns `null` when the address needs `*addr*` but there's no connected
 * host yet to substitute — the caller's cue to show a "not connected"
 * placeholder instead of an iframe pointed at a literal "*addr*" host.
 */
export function resolveWebPanelUrl(address: string, connectedHost: string | null): string | null {
  let resolved = address.trim();
  if (usesConnectedAddress(resolved)) {
    if (!connectedHost) return null;
    resolved = resolved.split(ADDR_PLACEHOLDER).join(connectedHost);
  }
  return /^https?:\/\//i.test(resolved) ? resolved : `http://${resolved}`;
}
