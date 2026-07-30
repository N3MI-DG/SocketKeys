<script setup lang="ts">
/** Right-frame panel: pick a Moonraker-served log file and watch it update live. */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { connectionState } from "../../lib/moonraker/connection";
import { formatLogLines } from "../../lib/logFormat";
import {
  loadLogFiles,
  logsState,
  rolloverApplication,
  rolloverSelectedLog,
  selectLog,
} from "../../lib/moonraker/logs";
import { showToast } from "../../lib/toast";
import FrameDropdown from "../FrameDropdown.vue";
import Dropdown from "../Dropdown.vue";

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

const fileOptions = computed(() =>
  logsState.files.map((file) => ({ id: file.path, label: file.path })),
);

const selectedFile = computed({
  get: () => logsState.selected ?? "",
  set: (path: string) => {
    if (path) void selectLog(path);
  },
});

const canRollover = computed(() => rolloverApplication(logsState.selected) !== null);

const lines = computed(() => formatLogLines(logsState.content));

async function handleRollover() {
  const path = logsState.selected;
  try {
    await rolloverSelectedLog();
    showToast(`Rolled over ${path}`);
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Rollover failed");
  }
}

function loadIfNeeded() {
  if (!connected.value) return;
  if (!logsState.filesLoaded && !logsState.filesLoading) void loadLogFiles();
}

onMounted(loadIfNeeded);
watch(() => connectionState.status, loadIfNeeded);

// Once the list arrives, default to klippy.log — the one people actually
// want to see first — falling back to the most recently modified file
// (`logsState.files` is sorted that way) if it's missing.
watch(
  () => logsState.filesLoaded,
  (loaded) => {
    if (loaded && !logsState.selected && logsState.files.length) {
      const klippyLog = logsState.files.find(
        (file) => (file.path.split("/").pop() ?? file.path) === "klippy.log",
      );
      void selectLog((klippyLog ?? logsState.files[0]).path);
    }
  },
);

const logEl = ref<HTMLElement | null>(null);
/** Set on selecting a new file, consumed by the next content update — a
 *  freshly opened log should always open snapped to its tail regardless of
 *  wherever the previous file's scroll position happened to be. */
let forcePinNext = false;

watch(
  () => logsState.selected,
  () => {
    forcePinNext = true;
  },
);

/**
 * Auto-follows new content, but only while the log was already scrolled to
 * (near) the bottom right before this update — read fresh here rather than
 * tracked via a `scroll` listener, since a listener's own `scrollTop`
 * assignment can race a fast-arriving next update (its `scroll` event firing
 * after `scrollHeight` had already grown again), reading a stale
 * distance-from-bottom and silently disabling auto-scroll for good. Reading
 * synchronously here, before the `await nextTick()` below (the watcher runs
 * pre-flush, so the DOM still reflects the *previous* content at that point),
 * can't drift out of sync with what actually changed.
 */
watch(
  () => logsState.content,
  async () => {
    const el = logEl.value;
    if (!el) return;
    const wasPinned =
      forcePinNext || el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    forcePinNext = false;
    if (!wasPinned) return;
    await nextTick();
    el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <div class="logs-panel">
    <div class="panel-header">
      <FrameDropdown :pane-index="paneIndex" />
      <div class="controls">
        <Dropdown
          v-if="fileOptions.length"
          v-model="selectedFile"
          :options="fileOptions"
          variant="field"
          ariaLabel="Choose log file"
          class="file-dropdown"
        />
        <button
          v-if="canRollover"
          class="icon-btn"
          type="button"
          title="Rollover log"
          aria-label="Rollover log"
          :disabled="logsState.rollingOver"
          @click="handleRollover"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>
    </div>

    <div ref="logEl" class="log">
      <p v-if="!connected" class="notice">{{ placeholder }}</p>
      <p v-else-if="logsState.filesError" class="notice error">
        {{ logsState.filesError }}
      </p>
      <p v-else-if="!logsState.filesLoaded" class="notice">Loading log files…</p>
      <p v-else-if="!logsState.files.length" class="notice">No log files found.</p>
      <p v-else-if="logsState.error" class="notice error">{{ logsState.error }}</p>
      <p v-else-if="!logsState.selected" class="notice">Select a log file.</p>
      <div v-else class="content">
        <template v-for="line in lines" :key="line.number">
          <span class="line-num">{{ line.number }}</span>
          <span class="line-text" :class="line.level"
            ><span v-if="line.prefix" class="line-prefix">{{ line.prefix }}</span
            >{{ line.rest }}</span
          >
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logs-panel {
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
  gap: 10px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--border);
}

.controls {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.file-dropdown {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 220px;
}

.icon-btn {
  flex: 0 0 auto;
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

.icon-btn:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: default;
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

.content {
  display: grid;
  grid-template-columns: max-content 1fr;
  padding: 6px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
}

.line-num {
  grid-column: 1;
  padding: 0 10px;
  text-align: right;
  border-right: 1px solid var(--border);
  color: var(--text-muted);
  opacity: 0.7;
  user-select: none;
}

.line-text {
  grid-column: 2;
  padding: 0 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.line-prefix {
  color: var(--text-muted);
}

.line-text.error {
  color: var(--error);
}

.line-text.warning {
  color: var(--warning);
}

.line-text.muted {
  color: var(--text-muted);
}
</style>
