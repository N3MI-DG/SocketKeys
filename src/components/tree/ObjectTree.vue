<script setup lang="ts">
/** Left-frame panel: the printer's live object tree, or why it isn't showing. */
import { computed, onMounted, ref, watch } from "vue";
import { connectionState } from "../../lib/moonraker/connection";
import {
  loadObjectList,
  objectStoreState,
} from "../../lib/moonraker/objectStore";
import TreeNode from "./TreeNode.vue";
import FrameDropdown from "../FrameDropdown.vue";

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

const filterText = ref("");
const filterInput = ref<HTMLInputElement | null>(null);

/** Top-level object names only — matches what's actually visible before
 *  expanding anything, which is what a name filter here should mean. */
const filteredNames = computed(() => {
  const query = filterText.value.trim().toLowerCase();
  if (!query) return objectStoreState.objectNames;
  return objectStoreState.objectNames.filter((name) =>
    name.toLowerCase().includes(query),
  );
});

function clearFilter() {
  filterText.value = "";
  filterInput.value?.blur();
}

function loadIfNeeded() {
  if (connected.value && !objectStoreState.listLoaded) void loadObjectList();
}

onMounted(loadIfNeeded);
watch(() => connectionState.status, loadIfNeeded);
</script>

<template>
  <div class="tree-panel">
    <div class="panel-header">
      <FrameDropdown :pane-index="paneIndex" />
      <input
        ref="filterInput"
        v-model="filterText"
        type="text"
        class="filter-input"
        placeholder="Filter…"
        autocomplete="off"
        spellcheck="false"
        aria-label="Filter printer objects"
        @keydown.escape="clearFilter"
      />
    </div>

    <p v-if="!connected" class="notice">{{ placeholder }}</p>
    <p v-else-if="objectStoreState.listError" class="notice error">
      {{ objectStoreState.listError }}
    </p>
    <p v-else-if="!objectStoreState.listLoaded" class="notice">
      Loading objects…
    </p>
    <p v-else-if="!objectStoreState.objectNames.length" class="notice">
      No objects reported.
    </p>
    <p v-else-if="!filteredNames.length" class="notice">
      No objects match "{{ filterText.trim() }}".
    </p>

    <ul v-else class="tree" role="tree" aria-label="Printer objects">
      <TreeNode
        v-for="name in filteredNames"
        :key="name"
        :label="name"
        kind="object-root"
      />
    </ul>
  </div>
</template>

<style scoped>
.tree-panel {
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

.filter-input {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 130px;
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

.filter-input::placeholder {
  color: var(--text-muted);
}

.filter-input:focus-visible {
  border-color: var(--accent);
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

.tree {
  flex: 1 1 auto;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  list-style: none;
}
</style>
