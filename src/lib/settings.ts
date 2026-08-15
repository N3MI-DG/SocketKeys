import { reactive, watch } from "vue";
import { FRAMES, defaultFrameId, getFrame } from "./frames";

const STORAGE_KEY = "socketkeys.settings.v1";

/** Choices offered in Settings for how often the Logs panel polls a tailed
 *  file for new bytes. Kept as a fixed set (rather than free entry) so the
 *  UI stays a Dropdown like every other setting. */
export const LOG_REFRESH_INTERVALS_MS = [1000, 2000, 5000, 10000] as const;
const DEFAULT_LOG_REFRESH_MS: (typeof LOG_REFRESH_INTERVALS_MS)[number] = 2000;

/** Choices offered in Settings for how long connection.ts keeps retrying
 *  after an unexpected drop before giving up and surfacing an error. `0`
 *  disables auto-reconnect entirely. */
export const RECONNECT_DURATIONS_S = [0, 10, 30, 60, 120, 300] as const;
const DEFAULT_RECONNECT_DURATION_S: (typeof RECONNECT_DURATIONS_S)[number] = 30;

/** How many panes the split layout can be configured to show — SplitPane.vue
 *  and App.vue both size around this range. */
export const MIN_PANE_COUNT = 1;
export const MAX_PANE_COUNT = 4;
const DEFAULT_PANE_COUNT = 2;

/** `null` means "use the theme's default for the active color scheme" —
 *  see the CSS-variable watchers below. Anything else must be `#rrggbb`,
 *  matching what a native `<input type="color">` and the preset swatches
 *  in ColorPicker.vue both produce. */
type ColorOverride = string | null;

interface PersistedSettings {
  /** What each pane was actually showing when the app last closed — both
   *  the pane count and per-pane frame choice, remembered exactly as it was
   *  left rather than a separately-configured "default" that could drift
   *  from what's really on screen. Length is the pane count
   *  (MIN_PANE_COUNT..MAX_PANE_COUNT). */
  panes: string[];
  logRefreshIntervalMs: number;
  reconnectDurationS: number;
  primaryColor: ColorOverride;
  accentColor: ColorOverride;
  /** Logs panel's "Suppress Stats" button — whether klippy.log's periodic
   *  "Stats ...: ..." lines are shown. */
  showKlippyStats: boolean;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isValidFrameId(id: unknown): id is string {
  return typeof id === "string" && getFrame(id) !== undefined;
}

function isValidLogRefreshMs(value: unknown): value is number {
  return typeof value === "number" && (LOG_REFRESH_INTERVALS_MS as readonly number[]).includes(value);
}

function isValidReconnectDuration(value: unknown): value is number {
  return typeof value === "number" && (RECONNECT_DURATIONS_S as readonly number[]).includes(value);
}

function isValidColorOverride(value: unknown): value is ColorOverride {
  return value === null || (typeof value === "string" && HEX_COLOR.test(value));
}

/** Validates a persisted pane list: right length, every id still exists.
 *  Returns `null` (rather than patching it up entry-by-entry) if it isn't
 *  usable as-is — the caller falls back to a fresh default in that case,
 *  same spirit as the legacy shape migrations below it. */
function sanitizePanes(candidate: unknown): string[] | null {
  if (!Array.isArray(candidate)) return null;
  if (candidate.length < MIN_PANE_COUNT || candidate.length > MAX_PANE_COUNT) return null;
  return candidate.every(isValidFrameId) ? (candidate as string[]) : null;
}

function loadPersisted(): PersistedSettings {
  const fallback: PersistedSettings = {
    panes: Array.from({ length: DEFAULT_PANE_COUNT }, (_, i) => defaultFrameId(i)),
    logRefreshIntervalMs: DEFAULT_LOG_REFRESH_MS,
    reconnectDurationS: DEFAULT_RECONNECT_DURATION_S,
    primaryColor: null,
    accentColor: null,
    showKlippyStats: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as
      | (Partial<PersistedSettings> & {
          /** Pre-remembered-layout shape: a separately-configured "default
           *  frame" rather than the actual last-shown layout. */
          defaultFrame?: { panes?: unknown; left?: string; right?: string };
        })
      | null;

    let panes = sanitizePanes(parsed?.panes) ?? sanitizePanes(parsed?.defaultFrame?.panes);
    if (!panes) {
      // Pre-multi-pane storage shape — carry a left/right pair forward into
      // a 2-entry pane list rather than silently discarding it.
      const legacy = parsed?.defaultFrame;
      panes =
        isValidFrameId(legacy?.left) && isValidFrameId(legacy?.right)
          ? [legacy.left, legacy.right]
          : fallback.panes;
    }

    const logRefreshIntervalMs = parsed?.logRefreshIntervalMs;
    const reconnectDurationS = parsed?.reconnectDurationS;
    return {
      panes,
      logRefreshIntervalMs: isValidLogRefreshMs(logRefreshIntervalMs)
        ? logRefreshIntervalMs
        : fallback.logRefreshIntervalMs,
      reconnectDurationS: isValidReconnectDuration(reconnectDurationS)
        ? reconnectDurationS
        : fallback.reconnectDurationS,
      primaryColor: isValidColorOverride(parsed?.primaryColor) ? parsed.primaryColor : fallback.primaryColor,
      accentColor: isValidColorOverride(parsed?.accentColor) ? parsed.accentColor : fallback.accentColor,
      showKlippyStats:
        typeof parsed?.showKlippyStats === "boolean"
          ? parsed.showKlippyStats
          : fallback.showKlippyStats,
    };
  } catch {
    return fallback; // malformed storage — start clean rather than crash
  }
}

const persisted = loadPersisted();

/** What's actually showing in each pane — switching frames via a header's
 *  dropdown, or resizing pane count in Settings, mutates this directly and
 *  it's persisted as-is (see the watcher below), so next launch reopens
 *  exactly where this one left off. */
export const activeFrame = reactive({
  panes: [...persisted.panes],
});

/** Other tunables, configured in the Settings modal. */
export const settingsState = reactive({
  logRefreshIntervalMs: persisted.logRefreshIntervalMs,
  reconnectDurationS: persisted.reconnectDurationS,
  primaryColor: persisted.primaryColor,
  accentColor: persisted.accentColor,
  showKlippyStats: persisted.showKlippyStats,
});

watch(
  () => ({
    panes: [...activeFrame.panes],
    logRefreshIntervalMs: settingsState.logRefreshIntervalMs,
    reconnectDurationS: settingsState.reconnectDurationS,
    primaryColor: settingsState.primaryColor,
    accentColor: settingsState.accentColor,
    showKlippyStats: settingsState.showKlippyStats,
  }),
  (snapshot) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot satisfies PersistedSettings));
  },
);

/**
 * Pushes color overrides onto the root element as inline styles, which beat
 * the `:root`/`prefers-color-scheme` rules in styles.css on specificity —
 * an override survives a light/dark switch, while `null` (never overridden,
 * or explicitly reset) cleanly falls back to whichever scheme's default
 * applies via `removeProperty` rather than needing to know that value here.
 */
function bindColorOverride(cssVar: string, get: () => ColorOverride): void {
  watch(
    get,
    (color) => {
      if (color) document.documentElement.style.setProperty(cssVar, color);
      else document.documentElement.style.removeProperty(cssVar);
    },
    { immediate: true },
  );
}

bindColorOverride("--primary", () => settingsState.primaryColor);
bindColorOverride("--accent", () => settingsState.accentColor);

export { FRAMES };
