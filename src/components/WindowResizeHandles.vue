<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

const EDGES = [
  { class: "n", direction: "North" },
  { class: "s", direction: "South" },
  { class: "e", direction: "East" },
  { class: "w", direction: "West" },
  { class: "ne", direction: "NorthEast" },
  { class: "nw", direction: "NorthWest" },
  { class: "se", direction: "SouthEast" },
  { class: "sw", direction: "SouthWest" },
] as const;

function startResize(event: MouseEvent, direction: (typeof EDGES)[number]["direction"]) {
  if (event.button !== 0) return;
  void appWindow.startResizeDragging(direction);
}
</script>

<template>
  <div
    v-for="edge in EDGES"
    :key="edge.class"
    :class="['resize-handle', edge.class]"
    @mousedown="startResize($event, edge.direction)"
  />
</template>

<style scoped>
.resize-handle {
  position: fixed;
  z-index: 1000;
}

.n,
.s {
  left: var(--resize-edge);
  right: var(--resize-edge);
  height: var(--resize-edge);
  cursor: ns-resize;
}

.e,
.w {
  top: var(--resize-edge);
  bottom: var(--resize-edge);
  width: var(--resize-edge);
  cursor: ew-resize;
}

.n {
  top: 0;
}

.s {
  bottom: 0;
}

.w {
  left: 0;
}

.e {
  right: 0;
}

.ne,
.nw,
.se,
.sw {
  width: 8px;
  height: 8px;
}

.ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.se {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}

.sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}
</style>
