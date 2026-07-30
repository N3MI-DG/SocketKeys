/**
 * Gcode console: sent-command log, live/backfilled printer responses, and
 * command-name help for autocomplete.
 *
 * Moonraker doesn't echo a sent command back over the websocket (confirmed by
 * reading Klipper's webhooks.py — `gcode_received` is only used internally
 * for its own history buffer), so the client echoes its own commands locally,
 * matching Mainsail's "optimistic echo" approach.
 */

import { reactive, watch } from "vue";
import { connectionState, getClient, onNotification } from "./connection";
import { objectStoreState } from "./objectStore";
import builtinCommandsData from "./klipper-builtins.json";
import type {
  BuiltinCommandInfo,
  GcodeCommandsResult,
  GcodeHelpResult,
  GcodeStoreResult,
  NotifyGcodeResponseParams,
  PrinterObjectsSubscribeResult,
} from "./types";

const builtinCommands = builtinCommandsData as Record<string, BuiltinCommandInfo>;

export type ConsoleEntryType = "command" | "response";

export interface ConsoleEntry {
  id: number;
  /** Seconds since epoch. Backfilled entries carry Klipper's real time;
   *  live ones use local receive time, since notifications carry none. */
  time: number;
  type: ConsoleEntryType;
  message: string;
}

export const consoleState = reactive({
  entries: [] as ConsoleEntry[],
  historyLoaded: false,
  historyError: null as string | null,
  /** Command name -> help text, for autocomplete. */
  gcodeHelp: {} as GcodeHelpResult,
  /** Session-only, not tied to a connection — survives reconnects. */
  commandHistory: [] as string[],
});

const MAX_ENTRIES = 500;
const MAX_COMMAND_HISTORY = 50;

let nextId = 1;

function makeEntry(
  type: ConsoleEntryType,
  message: string,
  time: number,
): ConsoleEntry {
  return { id: nextId++, time, type, message };
}

function trimEntries(): void {
  if (consoleState.entries.length > MAX_ENTRIES) {
    consoleState.entries.splice(0, consoleState.entries.length - MAX_ENTRIES);
  }
}

export async function loadHistory(count = 200): Promise<void> {
  const client = getClient();
  if (!client || consoleState.historyLoaded) return;

  try {
    const result = await client.call<GcodeStoreResult>("server.gcode_store", {
      count,
    });
    const backfilled = (result?.gcode_store ?? []).map((item) =>
      makeEntry(
        item.type === "command" ? "command" : "response",
        item.message,
        item.time,
      ),
    );
    // Merge rather than prepend: a live notification could already have
    // arrived while this request was in flight.
    consoleState.entries = [...backfilled, ...consoleState.entries].sort(
      (a, b) => a.time - b.time,
    );
    trimEntries();
    consoleState.historyLoaded = true;
  } catch (err) {
    consoleState.historyError =
      err instanceof Error ? err.message : String(err);
  }
}

export async function loadGcodeHelp(): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const result = await client.call<PrinterObjectsSubscribeResult>(
      "printer.objects.query",
      { objects: { gcode: ["commands"] } },
    );
    const commands = (result?.status?.gcode as GcodeCommandsResult | undefined)
      ?.commands;
    const help: GcodeHelpResult = {};
    for (const [name, info] of Object.entries(commands ?? {})) {
      help[name] = info.help ?? "";
    }
    consoleState.gcodeHelp = help;
  } catch (err) {
    console.warn("[moonraker] gcode help failed", err);
  }
}

export async function sendCommand(raw: string): Promise<void> {
  const script = raw.trim();
  if (!script) return;

  consoleState.entries.push(makeEntry("command", script, Date.now() / 1000));
  trimEntries();

  consoleState.commandHistory.push(script);
  if (consoleState.commandHistory.length > MAX_COMMAND_HISTORY) {
    consoleState.commandHistory.shift();
  }

  const client = getClient();
  if (!client) {
    consoleState.entries.push(
      makeEntry("response", "!! Not connected", Date.now() / 1000),
    );
    return;
  }

  try {
    await client.call("printer.gcode.script", { script });
  } catch (err) {
    // Klipper-side errors already arrive via notify_gcode_response ("!! ...")
    // — this only catches transport failures (socket dropped mid-flight),
    // so it's logged rather than duplicated into the visible log.
    console.warn("[moonraker] gcode script call failed", err);
  }
}

export function clear(): void {
  consoleState.entries = [];
}

/** Connection-scoped state only — command history is a client-side convenience
 *  that outlives any single connection. */
export function reset(): void {
  consoleState.entries = [];
  consoleState.historyLoaded = false;
  consoleState.historyError = null;
  consoleState.gcodeHelp = {};
  for (const key of Object.keys(macroSource)) delete macroSource[key];
  macroSourceQuery = null;
  macroSourceStatus.state = "idle";
  macroSourceStatus.error = null;
}

// --- Macro parameter syntax, for the console's autocomplete detail view ---
//
// Klipper's `gcode.get_command_help()` (the source of `gcodeHelp` above) only
// returns a one-line description per command — no parameter schema exists for
// built-in commands. For user-defined `gcode_macro`s, though, the printer's
// raw config text is queryable, and a macro's actual parameters are whatever
// `params.NAME` references its gcode template contains. We fetch that config
// text once (it's static for the session) and regex-scan it on demand.

/**
 * Raw `gcode:` template text per macro's printer-object name (e.g.
 * "gcode_macro START_PRINT"). Reactive so the console's detail popover
 * updates automatically once this resolves, even if it's already open.
 */
const macroSource = reactive<Record<string, string>>({});
let macroSourceQuery: Promise<void> | null = null;

/**
 * Distinct from `macroSource` having no entry for a given macro: that's
 * ambiguous between "still fetching" and "fetch finished, found nothing for
 * this one" — which look identical to a plain `undefined` check and would
 * otherwise show a permanent, misleading "loading" state for the latter.
 */
export const macroSourceStatus = reactive({
  state: "idle" as "idle" | "loading" | "loaded" | "error",
  error: null as string | null,
});

export async function ensureMacroSourceLoaded(): Promise<void> {
  if (macroSourceQuery) return macroSourceQuery;
  const client = getClient();
  if (!client) return;

  macroSourceStatus.state = "loading";
  macroSourceStatus.error = null;

  macroSourceQuery = (async () => {
    try {
      // Request every field (not just "config") — configfile also exposes a
      // separately-tracked "settings" view, and falling back to it covers
      // any case where a macro's `gcode:` text isn't captured in "config"
      // for some reason specific to how it was loaded.
      const result = await client.call<PrinterObjectsSubscribeResult>(
        "printer.objects.query",
        { objects: { configfile: null } },
      );
      const configfile = result?.status?.configfile as
        | {
            config?: Record<string, Record<string, unknown>>;
            settings?: Record<string, Record<string, unknown>>;
          }
        | undefined;

      // `configfile.settings` keys come back lowercased regardless of how the
      // section was actually written (`configfile.config` preserves the
      // original case) — confirmed by cross-checking Mainsail's own getter,
      // which explicitly lowercases before indexing into `settings` for
      // exactly this reason. Match section names case-insensitively against
      // the real printer-object name and store under *that* casing, so a
      // later `macroSource[objectName]` lookup (which always uses the
      // objects.list casing) hits regardless of which bucket supplied it.
      const sources = [configfile?.config, configfile?.settings];
      for (const sectionMap of sources) {
        for (const [section, options] of Object.entries(sectionMap ?? {})) {
          if (!section.toLowerCase().startsWith("gcode_macro ") || typeof options.gcode !== "string") {
            continue;
          }
          const objectName =
            objectStoreState.objectNames.find(
              (name) => name.toLowerCase() === section.toLowerCase(),
            ) ?? section;
          if (!(objectName in macroSource)) {
            macroSource[objectName] = options.gcode;
          }
        }
      }
      macroSourceStatus.state = "loaded";
    } catch (err) {
      macroSourceStatus.state = "error";
      macroSourceStatus.error = err instanceof Error ? err.message : String(err);
      console.warn("[moonraker] configfile query failed", err);
    }
  })();
  return macroSourceQuery;
}

export interface MacroParam {
  name: string;
  default: string | null;
  /** Jinja filter hint (`|int`, `|string`, `|double`), if the template used one. */
  type: string | null;
}

/**
 * Only `[gcode_macro NAME]` sections have inspectable syntax at all — their
 * body is plain text sitting in the config, readable via `configfile`. Every
 * other command (Klipper built-ins like RESPOND, or a third-party extras
 * plugin like K-ShakeTune's COMPARE_BELTS_RESPONSES) is registered straight
 * from Python; its argument parsing lives in code Moonraker never exposes.
 * There is no API path to a parameter schema for those — this lookup isn't
 * an incomplete regex, it's the ceiling of what Klipper's API can offer.
 */
function findMacroObjectName(commandName: string): string | null {
  const upper = commandName.toUpperCase();
  return (
    objectStoreState.objectNames.find(
      (name) =>
        name.startsWith("gcode_macro ") &&
        name.slice("gcode_macro ".length).toUpperCase() === upper,
    ) ?? null
  );
}

/** Raw `gcode:` template text for a macro, e.g. as a syntax fallback when no
 *  named `params.X` references are found (some macros just forward `{rawparams}`
 *  to a shell command instead of destructuring named arguments). */
export function getMacroSource(commandName: string): string | null {
  const objectName = findMacroObjectName(commandName);
  return objectName ? (macroSource[objectName] ?? null) : null;
}

/** True for any `[gcode_macro NAME]`, regardless of whether its source has
 *  loaded yet — lets the UI distinguish "not a macro" from "still loading". */
export function isKnownMacro(commandName: string): boolean {
  return findMacroObjectName(commandName) !== null;
}

/**
 * Bundled fallback for Klipper's own built-in/extended commands (G28,
 * RESPOND, SET_SERVO, ...) — see `klipper-builtins.json` / `scripts/
 * generate_klipper_builtins.py`. These are never `[gcode_macro]`s (no
 * `GCodeMacro` object gets constructed for them), so nothing here overlaps
 * with `getMacroParams` — a command is one or the other, never both.
 */
export function getBuiltinInfo(commandName: string): BuiltinCommandInfo | null {
  return builtinCommands[commandName.toUpperCase()] ?? null;
}

/**
 * Parameters a gcode_macro's template references. Two passes, mirroring how
 * Mainsail's own (independently-arrived-at) `getMacroParams` helper does this
 * — confirming this regex-over-raw-gcode-text approach is the actual ceiling
 * of what's inferable, not a gap unique to this implementation:
 *
 *  1. Direct access — `params.NAME` or `params['NAME']` — optionally with a
 *     `|int`/`|string`/`|double` type filter (either side of `|default(...)`).
 *  2. Membership tests — `{% if 'NAME' in params %}` / `not in params` — for
 *     params a macro only checks the presence of without ever extracting a
 *     value (recorded with no type/default, since none is ever stated).
 *
 * Returns `null` when `commandName` isn't a known macro at all — distinct
 * from `[]`, which means "confirmed macro, zero named param references found".
 */
export function getMacroParams(commandName: string): MacroParam[] | null {
  const objectName = findMacroObjectName(commandName);
  if (!objectName) return null;

  const source = macroSource[objectName];
  if (source === undefined) return null;

  const seen = new Map<string, { default: string | null; type: string | null }>();

  const accessPattern =
    /params(?:\.([A-Za-z_]\w*)|\[['"]([A-Za-z_]\w*)['"]\])(?:\s*\|\s*(int|string|double))?(?:\s*\|\s*default\(\s*['"]?([^,)'"]*)['"]?\s*\))?(?:\s*\|\s*(int|string|double))?/g;
  let match: RegExpExecArray | null;
  while ((match = accessPattern.exec(source))) {
    const name = match[1] ?? match[2];
    const type = match[3] ?? match[5] ?? null;
    const def = match[4]?.trim() || null;
    if (!seen.has(name)) seen.set(name, { default: def, type });
  }

  const membershipPattern = /['"]([A-Za-z_]\w*)['"]\s+(?:not\s+)?in\s+params\b/g;
  while ((match = membershipPattern.exec(source))) {
    const name = match[1];
    if (!seen.has(name)) seen.set(name, { default: null, type: null });
  }

  return [...seen.entries()].map(([name, info]) => ({ name, ...info }));
}

onNotification("notify_gcode_response", (params) => {
  const [message] = (params ?? []) as Partial<NotifyGcodeResponseParams>;
  if (typeof message !== "string") return;
  consoleState.entries.push(makeEntry("response", message, Date.now() / 1000));
  trimEntries();
});

watch(
  () => connectionState.status,
  (status) => {
    if (status !== "connected") reset();
  },
);
