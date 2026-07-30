<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { connectionState } from "../../lib/moonraker/connection";
import {
  clear,
  consoleState,
  ensureMacroSourceLoaded,
  loadGcodeHelp,
  loadHistory,
  type ConsoleEntry,
} from "../../lib/moonraker/console";
import ConsoleInput from "./ConsoleInput.vue";
import FrameDropdown from "../FrameDropdown.vue";
import { formatConsoleMessage } from "../../lib/consoleFormat";

defineProps<{ paneIndex: number }>();

const connected = computed(() => connectionState.status === "connected");

const placeholder = computed(() => {
  switch (connectionState.status) {
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return connectionState.error ?? "Reconnecting…";
    case "error":
      return connectionState.error ?? "Connection failed";
    default:
      return "Not connected";
  }
});

const logEl = ref<HTMLElement | null>(null);

/**
 * Auto-follows new output, but only while the log was already scrolled to
 * (near) the bottom right before this update. Deliberately reads scroll
 * position fresh on each update rather than tracking it via a separate
 * `scroll` listener: a burst of rapid pushes (a multi-line macro response
 * firing several `notify_gcode_response`s within milliseconds) let that
 * listener's own `scrollTop` assignment race the *next* push's DOM patch —
 * by the time its resulting `scroll` event actually fired, `scrollHeight`
 * had already grown past what it accounted for, so it read a stale
 * distance-from-bottom, wrongly concluded the user had scrolled away, and
 * silently disabled auto-scroll for good. Reading fresh here, synchronously
 * before the `await nextTick()` below (the watcher runs pre-flush, so the
 * DOM still reflects the *previous* entry count at that point), can't drift
 * out of sync with what actually changed.
 */
watch(
  () => consoleState.entries.length,
  async () => {
    const el = logEl.value;
    if (!el) return;
    const wasPinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!wasPinned) return;
    await nextTick();
    el.scrollTop = el.scrollHeight;
  },
);

function loadIfNeeded() {
  if (!connected.value) return;
  if (!consoleState.historyLoaded) void loadHistory();
  if (!Object.keys(consoleState.gcodeHelp).length) void loadGcodeHelp();
  void ensureMacroSourceLoaded();
}

onMounted(async () => {
  loadIfNeeded();
  // `consoleState.entries` may already be populated (e.g. switching back to
  // this frame after being connected a while) — the length-driven watch
  // above only fires on a *change*, so a fresh mount needs its own explicit
  // jump to the bottom rather than starting scrolled to the top.
  await nextTick();
  const el = logEl.value;
  if (el) el.scrollTop = el.scrollHeight;
});
watch(() => connectionState.status, loadIfNeeded);

function entryClass(entry: ConsoleEntry): string {
  if (entry.type === "command") return "command";
  const trimmed = entry.message.trimStart();
  if (trimmed.startsWith("!!")) return "error";
  if (trimmed.startsWith("//")) return "info";
  return "response";
}

function formatTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], {
    hour12: false,
  });
}
</script>

<template>
  <div class="console-panel">
    <div class="panel-header">
      <FrameDropdown :pane-index="paneIndex" />
      <button
        class="icon-btn"
        type="button"
        title="Clear console"
        aria-label="Clear console"
        @click="clear()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    </div>

    <div ref="logEl" class="log">
      <p v-if="!connected" class="notice">{{ placeholder }}</p>
      <p v-else-if="consoleState.historyError" class="notice error">
        {{ consoleState.historyError }}
      </p>
      <p v-else-if="!consoleState.entries.length" class="notice">
        No output yet.
      </p>

      <div
        v-for="entry in consoleState.entries"
        :key="entry.id"
        class="entry"
        :class="entryClass(entry)"
      >
        <span class="time">{{ formatTime(entry.time) }}</span>
        <span class="message" v-html="formatConsoleMessage(entry.message)"></span>
      </div>
    </div>

    <ConsoleInput :disabled="!connected" />
  </div>
</template>

<style scoped>
.console-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  flex: 0 0 auto;
  height: var(--panel-header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid var(--border);
}

.icon-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.icon-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}

.icon-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.notice {
  margin: 0;
  padding: 16px;
  font-size: 13px;
  color: var(--text-muted);
}

.notice.error {
  color: var(--error);
}

.log {
  flex: 1 1 auto;
  overflow: auto;
  padding: 6px 0;
}

.entry {
  display: flex;
  gap: 10px;
  padding: 2px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.time {
  flex: 0 0 auto;
  color: var(--text-muted);
  opacity: 0.7;
}

.message {
  flex: 1 1 auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
}

/* Some Klipper extras (e.g. AFC-Klipper-Add-On) color their console output
 * with Vuetify's text-color utility classes, since that's what Mainsail's
 * theme exposes — map the ones actually seen in the wild onto our own theme
 * tokens so that markup renders with a matching color here too. */
.message :deep(.error--text) {
  color: var(--error);
}

.message :deep(.warning--text) {
  color: var(--warning);
}

.message :deep(.success--text) {
  color: var(--success);
}

.message :deep(.info--text),
.message :deep(.primary--text),
.message :deep(.accent--text) {
  color: var(--accent);
}

.message :deep(.secondary--text) {
  color: var(--text-muted);
}

.entry.command .message {
  color: var(--accent);
}

.entry.command .message::before {
  content: "❯ ";
}

.entry.info .message {
  color: var(--text-muted);
}

.entry.error .message {
  color: var(--error);
}
</style>
