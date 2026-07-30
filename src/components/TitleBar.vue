<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  connect,
  connectionState,
  disconnect,
} from "../lib/moonraker/connection";
import { recentConnections } from "../lib/recentConnections";

const settingsOpen = defineModel<boolean>("settingsOpen", { default: false });

const appWindow = getCurrentWindow();
const isMaximized = ref(false);

// `recentConnections` is loaded from localStorage synchronously at import
// time, so the most recent entry is already available for this initializer.
const address = ref(recentConnections[0] ?? "");
/** Optional — only needed when the printer isn't on the default Moonraker
 *  port. Kept separate from `address` rather than making the user type
 *  "host:port" themselves; connect() still just gets one combined string. */
const port = ref("");

const combinedAddress = computed(() => {
  const host = address.value.trim();
  const explicitPort = port.value.trim();
  return explicitPort ? `${host}:${explicitPort}` : host;
});

const suggestionsOpen = ref(false);
/** -1 = nothing highlighted (Enter submits the typed address as-is); 0..n-1
 *  = a recent entry, arrived at via Up/Down. */
const highlightIndex = ref(-1);
const inputEl = ref<HTMLInputElement | null>(null);

function openSuggestions() {
  if (recentConnections.length) {
    suggestionsOpen.value = true;
    highlightIndex.value = -1;
  }
}

function selectRecent(value: string) {
  address.value = value;
  // A remembered entry is already a complete address (it's whatever was
  // actually connected with, port included if one was used) — clear this
  // so it doesn't silently get appended on top.
  port.value = "";
  suggestionsOpen.value = false;
  inputEl.value?.focus();
  // The input is only focusable (so only reachable here) while disconnected,
  // same precondition toggleConnection already relies on for a plain Connect.
  void connect(value);
}

function onAddressKeydown(event: KeyboardEvent) {
  if (!suggestionsOpen.value || !recentConnections.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightIndex.value = Math.min(highlightIndex.value + 1, recentConnections.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightIndex.value = Math.max(highlightIndex.value - 1, -1);
  } else if (event.key === "Enter" && highlightIndex.value !== -1) {
    event.preventDefault();
    selectRecent(recentConnections[highlightIndex.value]);
  } else if (event.key === "Escape") {
    suggestionsOpen.value = false;
  }
}

let unlisten: (() => void) | undefined;

async function syncMaximized() {
  isMaximized.value = await appWindow.isMaximized();
}

onMounted(async () => {
  await syncMaximized();
  unlisten = await appWindow.onResized(syncMaximized);
});

onUnmounted(() => unlisten?.());

const connected = computed(() => connectionState.status === "connected");
const connecting = computed(() => connectionState.status === "connecting");
const reconnecting = computed(() => connectionState.status === "reconnecting");

/** Only meaningful once the websocket itself is up — Klipper's state is
 *  irrelevant noise while we're not even connected to Moonraker. */
const klippyLabel = computed(() => {
  if (!connected.value) return "";
  switch (connectionState.klippyState) {
    case "shutdown":
      return "Klipper Shutdown";
    case "error":
      return "Klipper Error";
    case "disconnected":
      return "Klipper Disconnected";
    case "startup":
      return "Klipper Starting…";
    default:
      return "";
  }
});

const connectLabel = computed(() => {
  if (connected.value) return "Disconnect";
  if (reconnecting.value) return "Reconnecting…";
  return connecting.value ? "Connecting…" : "Connect";
});

// Reconnecting is deliberately still clickable (unlike connecting) — it's
// the only way to cancel the automatic retry loop early, via the same
// disconnect() path a plain Disconnect uses.
const connectDisabled = computed(
  () => connecting.value || (!connected.value && !reconnecting.value && !address.value.trim()),
);

function toggleConnection() {
  if (connecting.value) return;
  if (connected.value || reconnecting.value) {
    disconnect();
    return;
  }
  void connect(combinedAddress.value);
}
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <div class="titlebar-start" data-tauri-drag-region>
      <span class="brand">SocketKeys</span>
    </div>

    <form class="connect-group" @submit.prevent="toggleConnection">
      <div class="ip-input-wrap">
        <input
          ref="inputEl"
          v-model="address"
          type="text"
          class="ip-input"
          placeholder="192.168.1.1"
          autocomplete="off"
          spellcheck="false"
          :disabled="connected || connecting || reconnecting"
          @focus="openSuggestions"
          @blur="suggestionsOpen = false"
          @keydown="onAddressKeydown"
        />
        <ul v-if="suggestionsOpen && recentConnections.length" class="popover">
          <li
            v-for="(recent, index) in recentConnections"
            :key="recent"
            :class="{ active: index === highlightIndex }"
            @mousedown.prevent="selectRecent(recent)"
          >
            {{ recent }}
          </li>
        </ul>
      </div>
      <input
        v-model="port"
        type="text"
        inputmode="numeric"
        class="port-input"
        placeholder="7125"
        autocomplete="off"
        spellcheck="false"
        aria-label="Port (optional)"
        title="Port (optional) — defaults to 7125"
        :disabled="connected || connecting || reconnecting"
      />
      <button
        type="submit"
        class="connect-btn"
        :class="{ connected: connected || reconnecting }"
        :disabled="connectDisabled"
      >
        {{ connectLabel }}
      </button>
      <span
        v-if="(connectionState.status === 'error' || reconnecting) && connectionState.error"
        class="connect-error"
        :title="connectionState.error"
      >
        {{ connectionState.error }}
      </span>
      <span v-else-if="klippyLabel" class="klippy-badge">
        {{ klippyLabel }}
      </span>
    </form>

    <div class="titlebar-spacer" data-tauri-drag-region />

    <div class="titlebar-end">
      <button
        class="control"
        type="button"
        title="Settings"
        aria-label="Settings"
        @click="settingsOpen = true"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          class="gear"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>

      <div class="window-controls">
        <button
          class="control"
          type="button"
          title="Minimize"
          aria-label="Minimize"
          @click="appWindow.minimize()"
        >
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" /></svg>
        </button>

        <button
          class="control"
          type="button"
          :title="isMaximized ? 'Restore' : 'Maximize'"
          :aria-label="isMaximized ? 'Restore' : 'Maximize'"
          @click="appWindow.toggleMaximize()"
        >
          <svg v-if="isMaximized" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" />
          </svg>
          <svg v-else viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5h9v9h-9z" />
          </svg>
        </button>

        <button
          class="control close"
          type="button"
          title="Close"
          aria-label="Close"
          @click="appWindow.close()"
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  flex: 0 0 auto;
  height: var(--titlebar-height);
  display: flex;
  align-items: center;
  padding-left: 12px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.titlebar-start {
  display: flex;
  align-items: center;
  height: 100%;
  padding-right: 16px;
}

.brand {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  white-space: nowrap;
}

.connect-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ip-input-wrap {
  position: relative;
  width: 160px;
}

.ip-input {
  width: 100%;
  height: 24px;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.ip-input::placeholder {
  color: var(--text-muted);
}

.ip-input:focus-visible {
  border-color: var(--accent);
}

.ip-input:disabled {
  color: var(--text-muted);
  background: var(--surface-2);
}

.port-input {
  width: 56px;
  height: 24px;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.port-input::placeholder {
  color: var(--text-muted);
}

.port-input:focus-visible {
  border-color: var(--accent);
}

.port-input:disabled {
  color: var(--text-muted);
  background: var(--surface-2);
}

.connect-btn {
  height: 24px;
  padding: 0 12px;
  border-radius: 5px;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.12s ease, background-color 0.12s ease, border-color 0.12s ease;
}

.connect-btn:hover {
  opacity: 0.9;
}

.connect-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.connect-btn.connected {
  background: transparent;
  color: var(--text-muted);
  border-color: var(--border);
}

.connect-btn.connected:hover {
  border-color: var(--text-muted);
  color: var(--text);
}

.popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 220px;
  margin: 0;
  padding: 4px;
  max-height: 260px;
  overflow: auto;
  list-style: none;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 25%);
  z-index: 10;
}

.popover li {
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.popover li.active {
  background: var(--surface-3);
}

.connect-error {
  max-width: 320px;
  font-size: 11px;
  color: var(--error);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.klippy-badge {
  max-width: 320px;
  font-size: 11px;
  font-weight: 600;
  color: var(--error);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.titlebar-spacer {
  flex: 1 1 auto;
  height: 100%;
}

.titlebar-end {
  display: flex;
  align-items: center;
  height: 100%;
}

.window-controls {
  display: flex;
  height: 100%;
}

.control {
  width: 46px;
  height: 100%;
  display: grid;
  place-items: center;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: default;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.titlebar-end > .control {
  cursor: pointer;
}

.control svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
}

.control svg.gear {
  width: 15px;
  height: 15px;
  stroke-width: 2;
}

.control:hover {
  background: var(--surface-3);
  color: var(--text);
}

.control.close:hover {
  background: #e81123;
  color: #fff;
}

.control:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -3px;
}
</style>
