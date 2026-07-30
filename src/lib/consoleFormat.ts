import DOMPurify from "dompurify";

/**
 * Some Klipper extras send console output containing raw HTML instead of
 * plain text — e.g. AFC-Klipper-Add-On's `AFC_logger.py` pipes messages like
 * `<span class=success--text>LOADED</span>` straight through
 * `notify_gcode_response` unescaped (confirmed by reading its `raw()`/
 * `info()`/`warning()` callbacks). Those `*--text` class names are Vuetify's
 * text-color utilities, which Mainsail's theme happens to expose — see
 * `.message :deep(...)` in ConsolePanel.vue for this app's equivalent.
 *
 * Sanitized before rendering via `v-html`, since this is otherwise arbitrary
 * text from the printer/firmware. Mirrors Mainsail's own
 * `formatConsoleMessage` (`DOMPurify.sanitize(message)` with no custom
 * allowlist), which is the proven-safe baseline for the exact same feed.
 */
export function formatConsoleMessage(message: string): string {
  return DOMPurify.sanitize(message);
}
