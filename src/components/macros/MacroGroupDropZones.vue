<script setup lang="ts">
/**
 * Fixed bar of category drop targets, shown while a macro button is being
 * dragged (see MacroCard.vue's dragstart, which sets `macroDragState`) —
 * dropping directly on a category name assigns the macro there without
 * opening that card's popover first.
 */
import { computed, ref } from "vue";
import { assignCommandGroup, macroDragState, macroGroups } from "../../lib/macroGroups";

const emit = defineEmits<{ requestNewGroup: [command: string] }>();

const UNGROUPED_ID = "__ungrouped__";
const ADD_NEW_ID = "__add_new__";

const hoveredId = ref<string | null>(null);

const zones = computed(() => [
  ...macroGroups.map((group) => ({ id: group.id, label: group.name })),
  { id: UNGROUPED_ID, label: "Ungrouped" },
  { id: ADD_NEW_ID, label: "+ New group…" },
]);

function onDrop(id: string) {
  const command = macroDragState.command;
  hoveredId.value = null;
  if (!command) return;
  if (id === ADD_NEW_ID) emit("requestNewGroup", command);
  else assignCommandGroup(command, id === UNGROUPED_ID ? null : id);
}
</script>

<template>
  <Teleport to="body">
    <!-- Always mounted (visibility toggled via CSS) rather than v-if'd, to
         avoid inserting a whole new element into the DOM right as dragstart
         fires. The container itself stays pointer-events:none even while
         active — only the individual pills opt back in — so its padding
         and gaps don't block dragging a card that happens to sit right
         where the (centered, fixed-position) bar renders on screen; only
         the actual pill rectangles are real drop targets. -->
    <div class="drop-bar" :class="{ active: macroDragState.command }">
      <div
        v-for="zone in zones"
        :key="zone.id"
        class="drop-zone"
        :class="{ hovered: hoveredId === zone.id }"
        @dragover.prevent="hoveredId = zone.id"
        @dragleave="hoveredId === zone.id && (hoveredId = null)"
        @drop.prevent="onDrop(zone.id)"
      >
        {{ zone.label }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drop-bar {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 300;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  max-width: min(90vw, 640px);
  max-height: 70vh;
  overflow-y: auto;
  padding: 10px;
  border-radius: 8px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  box-shadow:
    0 5px 5px -3px rgb(0 0 0 / 20%),
    0 8px 10px 1px rgb(0 0 0 / 14%),
    0 3px 14px 2px rgb(0 0 0 / 12%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.drop-bar.active {
  opacity: 1;
}

.drop-zone {
  padding: 8px 14px;
  border-radius: 6px;
  border: 1px dashed var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  pointer-events: none;
  transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
}

.drop-bar.active .drop-zone {
  pointer-events: auto;
}

.drop-zone.hovered {
  border-style: solid;
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--text);
}
</style>
