/**
 * Log file listing + live content — moonraker.log, klippy.log, etc.
 *
 * Discovery and change notifications ride the existing websocket
 * (`server.files.list`, `notify_filelist_changed`), but actual file
 * *content* is only ever served over plain HTTP by Moonraker — there is no
 * RPC equivalent (verified directly in file_manager.py/application.py).
 * Fetched here via Tauri's HTTP plugin specifically because a normal
 * browser `fetch()` would be blocked by Moonraker's CORS policy for this
 * app's origin: `cors_domains` is opt-in in moonraker.conf, and nobody
 * pre-configures a Tauri app's `tauri://localhost` origin into it. Running
 * the request from the Rust side sidesteps browser CORS entirely.
 *
 * "Live" comes from HTTP Range requests: Moonraker's FileRequestHandler
 * implements Range itself (not just passthrough — confirmed in
 * application.py), so each refresh only fetches bytes appended since the
 * last read. A shrinking size means the file was rotated/truncated, handled
 * by re-fetching from byte 0.
 *
 * `notify_filelist_changed` alone isn't enough to drive this: Moonraker's
 * inotify watcher only ever emits a `modify_file` notification from
 * `complete_file_write()`, which fires on `IN_CLOSE_WRITE` (confirmed in
 * file_manager.py) — and neither Klipper nor Moonraker close/reopen their
 * log's file handle while running, only on process exit/restart. So during
 * normal operation that notification simply never arrives; it only shows up
 * incidentally around rollover/restart, which is a structural change we
 * already resync on. A short poll while a log is selected is what actually
 * makes the view live — Mainsail sidesteps this entirely by not offering a
 * live tail at all (its log panel is just a download link).
 */

import { reactive, watch } from "vue";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { connectionState, getClient, onNotification } from "./connection";
import { settingsState } from "../settings";
import type {
  FileListItem,
  NotifyFilelistChangedParams,
} from "./types";

/** Characters kept in memory/on screen — oldest trimmed first, like the console log. */
const MAX_CONTENT_LENGTH = 200_000;

export const logsState = reactive({
  files: [] as FileListItem[],
  filesLoaded: false,
  filesLoading: false,
  filesError: null as string | null,
  selected: null as string | null,
  content: "",
  lineOffset: 0,
  pinnedToBottom: true,
  loading: false,
  error: null as string | null,
  rollingOver: false,
});

/**
 * `server.logs.rollover` only knows about the two live process logs by
 * *application name*, not by file path (confirmed in loghelper.py /
 * klippy_connection.py) — there's no API to roll over an arbitrary log file.
 * Mapped by filename since that's the only link the client has to "which
 * app owns this file"; anything else (dmesg, crash dumps, plugin logs) has
 * no rollover support at all.
 */
const ROLLOVER_APPLICATIONS: Record<string, string> = {
  "moonraker.log": "moonraker",
  "klippy.log": "klipper",
};

/** Which `server.logs.rollover` application (if any) owns the given path. */
export function rolloverApplication(path: string | null): string | null {
  if (!path) return null;
  const base = path.split("/").pop() ?? path;
  return ROLLOVER_APPLICATIONS[base] ?? null;
}

/** Excludes dmesg, crash dumps, and rollover backups (renamed aside with a
 *  timestamp suffix, so they no longer end in `.log`) from the dropdown. */
function isLogFile(path: string): boolean {
  return path.toLowerCase().endsWith(".log");
}

/** Bytes already fetched for the selected file — drives the next Range request. */
let knownSize = 0;

/**
 * Consecutive failed tail polls. A single failure is nearly always the HTTP
 * keep-alive connection being reused a moment after Moonraker closed it
 * (Tornado times idle connections out; the pool behind `tauriFetch` finds
 * out by writing into a socket that's already gone), and the very next poll
 * succeeds. That's a transport hiccup on a *different* connection than the
 * websocket, which stays open throughout — so surfacing it immediately made
 * the panel flash a connection error every few minutes for no reason.
 */
let consecutiveFailures = 0;

/** How many polls in a row must fail before it's worth telling the user. */
const FAILURES_BEFORE_ERROR = 3;

let tailTimer: ReturnType<typeof setInterval> | null = null;

function stopTailPolling(): void {
  if (tailTimer !== null) {
    clearInterval(tailTimer);
    tailTimer = null;
  }
}

function startTailPolling(): void {
  stopTailPolling();
  tailTimer = setInterval(() => {
    // Skip a tick rather than pile up overlapping requests if the previous
    // fetch is still in flight (e.g. a slow connection).
    if (!logsState.loading) void refreshLog();
  }, settingsState.logRefreshIntervalMs);
}

// Settings changes should take effect on the log already being tailed, not
// just the next one selected — restart the timer at the new interval.
watch(
  () => settingsState.logRefreshIntervalMs,
  () => {
    if (tailTimer !== null) startTailPolling();
  },
);

export async function loadLogFiles(): Promise<void> {
  const client = getClient();
  if (!client || logsState.filesLoading) return;

  logsState.filesLoading = true;
  logsState.filesError = null;
  try {
    const result = await client.call<FileListItem[]>("server.files.list", {
      root: "logs",
    });
    logsState.files = (Array.isArray(result) ? result : [])
      .filter((file) => isLogFile(file.path))
      .sort((a, b) => b.modified - a.modified);
    logsState.filesLoaded = true;
  } catch (err) {
    logsState.filesError = err instanceof Error ? err.message : String(err);
  } finally {
    logsState.filesLoading = false;
  }
}

export async function selectLog(path: string): Promise<void> {
  logsState.selected = path;
  logsState.content = "";
  logsState.lineOffset = 0;
  logsState.pinnedToBottom = true;
  logsState.error = null;
  knownSize = 0;
  consecutiveFailures = 0;
  startTailPolling();
  await refreshLog();
}

/** Fetches whatever's new since the last read — or the whole file, the
 *  first time or after a detected rotation. */
export async function refreshLog(isRetry = false): Promise<void> {
  const path = logsState.selected;
  const base = connectionState.httpBaseUrl;
  if (!path || !base) return;

  logsState.loading = true;
  try {
    const url = `${base}/server/files/logs/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const headers: Record<string, string> =
      knownSize > 0 ? { Range: `bytes=${knownSize}-` } : {};
    const response = await tauriFetch(url, { method: "GET", headers });

    if (response.status === 416) {
      // A 416 here is *usually* just "nothing was appended since the last
      // poll": `bytes=<size>-` starts exactly at EOF, which RFC 9110 counts
      // as unsatisfiable, and Tornado (which serves this handler) answers
      // that with 416 rather than an empty 206. Only a *shrinking* file
      // means a real rotation/truncation, and the two are distinguishable
      // by the total in the mandatory `Content-Range: bytes */<size>`.
      // Treating every idle poll as a rotation re-downloaded the whole file
      // and reset lineOffset each tick, which re-rendered the panel with a
      // different set of lines (the untrimmed head comes back, numbering
      // restarts at 1) and visibly shifted the reading position back and
      // forth on every poll.
      const total = parseContentRangeTotal(response.headers.get("content-range"));
      if (total === knownSize) {
        markPollSucceeded();
        return;
      }

      knownSize = 0;
      logsState.lineOffset = 0;
      if (!isRetry) return refreshLog(true);
      throw new Error("Log file could not be read after rotation");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    const declaredLength = Number(response.headers.get("content-length"));
    const byteLength = Number.isFinite(declaredLength) && declaredLength > 0
      ? declaredLength
      : new TextEncoder().encode(text).length;

    if (response.status === 206) {
      // A 206 guarantees `text` is a partial body, never the full file,
      // regardless of whether Content-Range came through parseable — so
      // this always appends. Content-Range's total is preferred for the
      // next Range request when available (authoritative — reflects the
      // server's actual current file size), but a locally-tracked running
      // offset is just as correct when it's missing or malformed, and
      // doesn't risk misreading a real partial response as the whole file.
      logsState.content += text;
      const rangeTotal = parseContentRangeTotal(response.headers.get("content-range"));
      knownSize = rangeTotal ?? knownSize + byteLength;
    } else {
      // Full 200 response: either the initial load, or the server ignored
      // our Range (some do, instead of a real partial response) — either
      // way this is the complete current file, so replace, not append.
      logsState.content = text;
      knownSize = byteLength;
    }

    trimContent();
    markPollSucceeded();
  } catch (err) {
    // Hold on to whatever is already on screen and stay quiet until the
    // failures look persistent rather than incidental — but say something
    // straight away when there's nothing displayed yet, since an empty
    // panel with no explanation is worse than a premature error.
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAILURES_BEFORE_ERROR || !logsState.content) {
      logsState.error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    logsState.loading = false;
  }
}

function markPollSucceeded(): void {
  consecutiveFailures = 0;
  logsState.error = null;
}

/**
 * Rolls over whichever app owns the currently selected log (renames it aside
 * with a timestamp and starts a fresh file at the same name — standard
 * `TimedRotatingFileHandler.doRollover` behavior on the Moonraker side).
 * Throws with the server's own message on failure so the caller can surface
 * it (e.g. "Cannot rollover log while printing" for klippy).
 */
export async function rolloverSelectedLog(): Promise<void> {
  const client = getClient();
  const app = rolloverApplication(logsState.selected);
  if (!client || !app || logsState.rollingOver) return;

  logsState.rollingOver = true;
  try {
    const result = await client.call<{
      rolled_over: string[];
      failed: Record<string, string>;
    }>("server.logs.rollover", { application: app });
    const failure = result.failed?.[app];
    if (failure) throw new Error(failure);
    // Deliberately no explicit refetch here: a klipper rollover stops the
    // service, renames the file, then restarts it — the restart alone can
    // take several seconds, so refetching the list immediately would race
    // it and (as observed against a real printer) permanently "lose" the
    // file from the dropdown the instant it briefly doesn't exist on disk.
    // notify_filelist_changed below is what keeps the list correct as the
    // rename and eventual recreate actually happen.
  } finally {
    logsState.rollingOver = false;
  }
}

function trimContent(): void {
  if (!logsState.pinnedToBottom) return;

  const overflow = logsState.content.length - MAX_CONTENT_LENGTH;
  if (overflow <= 0) return;

  let cut = logsState.content.indexOf("\n", overflow);
  cut = cut === -1 ? logsState.content.length : cut + 1;

  const removed = logsState.content.slice(0, cut);
  logsState.lineOffset += (removed.match(/\n/g) ?? []).length;
  logsState.content = logsState.content.slice(cut);
}

function parseContentRangeTotal(headerValue: string | null): number | null {
  // Format: "bytes 200-1000/67589" — total is the part after the slash.
  if (!headerValue) return null;
  const match = /\/(\d+)$/.exec(headerValue);
  return match ? Number(match[1]) : null;
}

export function reset(): void {
  stopTailPolling();
  logsState.files = [];
  logsState.filesLoaded = false;
  logsState.filesLoading = false;
  logsState.filesError = null;
  logsState.selected = null;
  logsState.content = "";
  logsState.lineOffset = 0;
  logsState.pinnedToBottom = true;
  logsState.loading = false;
  logsState.error = null;
  logsState.rollingOver = false;
  knownSize = 0;
  consecutiveFailures = 0;
}

/** Removes any entry at `path` from the in-memory file list, if present. */
function dropFile(path: string): void {
  const idx = logsState.files.findIndex((f) => f.path === path);
  if (idx !== -1) logsState.files.splice(idx, 1);
}

onNotification("notify_filelist_changed", (params) => {
  const [info] = (params ?? []) as Partial<NotifyFilelistChangedParams>;
  if (!info) return;

  // Too broad to reconcile item-by-item (e.g. after the directory watcher
  // loses track of things and falls back to a full rescan) — just resync.
  if (info.action === "root_update") {
    if (info.item?.root === "logs") void loadLogFiles();
    return;
  }

  const item = info.item;
  if (!item || item.root !== "logs") return;

  // A rename (e.g. rollover renaming moonraker.log/klippy.log aside before
  // recreating it) reports the old location separately — it must be
  // dropped explicitly, since `item` below only ever describes the new one.
  if (info.source_item?.root === "logs") dropFile(info.source_item.path);

  if (info.action === "delete_file" || info.action === "delete_dir") {
    dropFile(item.path);
  } else {
    const existing = logsState.files.find((f) => f.path === item.path);
    if (existing) {
      existing.size = item.size;
      existing.modified = item.modified;
    } else if (isLogFile(item.path)) {
      // New to us — a file recreated after having briefly not existed (e.g.
      // klipper's log once it finishes restarting). `knownSize` is stale in
      // that case: it describes byte offsets into the *previous* file at
      // this path, which have no relationship to this one — trusting it
      // would send a Range request that happens to be satisfiable against
      // the new file by sheer coincidence and splice an unrelated fragment
      // onto the old content instead of replacing it. Forcing a full
      // re-read is the only correct move here.
      if (item.path === logsState.selected) {
        knownSize = 0;
        logsState.lineOffset = 0;
      }
      logsState.files.push({ ...item });
      logsState.files.sort((a, b) => b.modified - a.modified);
    }
  }

  if (item.path === logsState.selected && !logsState.loading) void refreshLog();
});

watch(
  () => connectionState.status,
  (status) => {
    if (status !== "connected") reset();
  },
);
