/**
 * Line-oriented formatting for the Logs panel: splits raw file content into
 * numbered rows, each with an optional dimmed prefix (timestamp/location)
 * split from the rest of the message, plus a severity used for coloring.
 *
 * moonraker.log's default (non-structured) line format is fixed by
 * `LogManager.__init__` in loghelper.py:
 *   '%(asctime)s [%(filename)s:%(funcName)s()] - %(message)s'
 * klippy.log has no such prefix at all — `queuelogger.QueueListener` never
 * calls `setFormatter`, so Python logging's bare `%(message)s` default
 * applies; its own periodic "Stats <time>: ..." lines are the closest thing
 * it has to a timestamp, so those get the same prefix treatment.
 *
 * Line numbers count rows within the currently buffered window (see
 * `MAX_CONTENT_LENGTH` in logs.ts), not absolute position in the file on
 * disk — the buffer is a sliding tail, so "line 1" points at whatever is
 * oldest in memory right now, not the file's actual first line.
 */

export type LogLevel = "error" | "warning" | "muted" | "normal";

export interface LogLine {
  number: number;
  /** Timestamp/location portion, dimmed separately when present. */
  prefix: string | null;
  rest: string;
  level: LogLevel;
}

const MOONRAKER_PREFIX =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} \[[^\]]+\] - )([\s\S]*)$/;
const KLIPPY_STATS_PREFIX = /^(Stats \d+\.\d+:\s*)([\s\S]*)$/;

const ROLLOVER_MARKER = /^=+ .* =+$/;
const TRACEBACK_START = /^Traceback \(most recent call last\):/;
const TRACEBACK_FRAME = /^\s+File "/;
// The exception line a traceback ends on, e.g. "ValueError: bad thing" —
// deliberately unanchored to "Traceback" since a caught-and-logged
// exception's summary line can appear on its own without one.
const EXCEPTION_SUMMARY = /^\S*(Error|Exception)\b:?/;

function classify(line: string): LogLevel {
  if (
    TRACEBACK_START.test(line) ||
    TRACEBACK_FRAME.test(line) ||
    EXCEPTION_SUMMARY.test(line) ||
    /\b(ERROR|CRITICAL)\b/.test(line)
  ) {
    return "error";
  }
  if (/\bWARNING\b/.test(line)) return "warning";
  if (ROLLOVER_MARKER.test(line) || /\bDEBUG\b/.test(line)) return "muted";
  return "normal";
}

export function formatLogLines(content: string): LogLine[] {
  if (!content) return [];

  // split() on a trailing "\n" leaves a phantom empty final element.
  const rawLines = content.split("\n");
  if (rawLines[rawLines.length - 1] === "") rawLines.pop();

  return rawLines.map((line, index) => {
    const match = MOONRAKER_PREFIX.exec(line) ?? KLIPPY_STATS_PREFIX.exec(line);
    return {
      number: index + 1,
      prefix: match ? match[1] : null,
      rest: match ? match[2] : line,
      level: classify(line),
    };
  });
}
