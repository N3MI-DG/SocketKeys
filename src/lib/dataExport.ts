/**
 * Export/import everything SocketKeys persists — settings, recent
 * connections, web panels, macro groups/assignments/collapsed state, etc.
 * Generic over key *names* (anything under the "socketkeys." prefix every
 * persisted module already uses) rather than enumerating each module's
 * storage key by hand, so a newly added persisted feature is swept up here
 * automatically without this file needing to change.
 */

const PREFIX = "socketkeys.";

export interface ExportedData {
  exportedAt: string;
  version: 1;
  data: Record<string, string>;
}

export function exportAllData(): ExportedData {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return { exportedAt: new Date().toISOString(), version: 1, data };
}

export function isExportedData(value: unknown): value is ExportedData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.data !== "object" || v.data === null || Array.isArray(v.data)) {
    return false;
  }
  return Object.values(v.data).every((entry) => typeof entry === "string");
}

/**
 * Restores every key in `payload.data` into localStorage — anything
 * outside the "socketkeys." namespace is ignored, in case of a hand-edited
 * or otherwise untrustworthy file. Existing keys not present in the
 * payload are left untouched; an import isn't required to be a full
 * snapshot.
 *
 * Every persisted module (settings.ts, macroGroups.ts, ...) only reads its
 * localStorage key once, at module load — writing new values here doesn't
 * touch their already-running reactive state, so the caller is responsible
 * for reloading the app afterward.
 */
export function importAllData(payload: ExportedData): void {
  for (const [key, value] of Object.entries(payload.data)) {
    if (!key.startsWith(PREFIX)) continue;
    localStorage.setItem(key, value);
  }
}
