<script setup lang="ts">
/**
 * N resizable panes (1-4) in a row, each with a draggable divider to its
 * right except the last. Content comes from a scoped default slot rather
 * than named slots (`#left`/`#right` as it used to be) — the caller doesn't
 * know its pane count ahead of time, so it can't declare N named slots.
 *
 * Each divider only resizes its own two immediate neighbors — dragging one
 * never moves any other pane's edge. Widths are tracked as percentages for
 * every pane *except* the last, which is deliberately left to flex-grow
 * fill whatever's left (see `.pane:last-of-type`) — that's what lets the
 * dividers' own pixel widths not have to be subtracted out of the math by
 * hand, same trick the old fixed 2-pane version used.
 */
import { ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    /** How many panes to render. */
    count: number;
    /** Smallest any pane is allowed to get, in pixels. */
    minPaneWidth?: number;
  }>(),
  { minPaneWidth: 160 },
);

const container = ref<HTMLElement | null>(null);
const widths = ref<number[]>(evenWidths(props.count));
const draggingIndex = ref<number | null>(null);

function evenWidths(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

// Settings' "Number of frames" control changes `count` live — redistribute
// evenly rather than leaving a stale/mismatched-length array. This does
// mean any manual resizing is lost when the count changes, not just when
// panes are added/removed, but that's an acceptable trade for staying simple.
watch(
  () => props.count,
  (count) => {
    widths.value = evenWidths(count);
  },
);

function minPercent(): number {
  const total = container.value?.clientWidth ?? 0;
  return total ? (props.minPaneWidth / total) * 100 : 0;
}

/** Sum of every pane's width before `index`, i.e. where it starts. */
function offsetBefore(index: number): number {
  let sum = 0;
  for (let i = 0; i < index; i++) sum += widths.value[i];
  return sum;
}

/** Moves divider `index` (between panes `index` and `index + 1`) to track
 *  the pointer, redistributing width only within that pair. */
function positionFromClientX(index: number, clientX: number) {
  const rect = container.value?.getBoundingClientRect();
  if (!rect) return;

  const pairTotal = widths.value[index] + widths.value[index + 1];
  const min = Math.min(minPercent(), pairTotal / 2);
  const pointerPercent = ((clientX - rect.left) / rect.width) * 100;

  let left = pointerPercent - offsetBefore(index);
  left = Math.min(Math.max(left, min), pairTotal - min);

  widths.value[index] = left;
  widths.value[index + 1] = pairTotal - left;
}

function onPointerDown(index: number, event: PointerEvent) {
  draggingIndex.value = index;
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(index: number, event: PointerEvent) {
  if (draggingIndex.value !== index) return;
  event.preventDefault();
  positionFromClientX(index, event.clientX);
}

function onPointerUp(index: number, event: PointerEvent) {
  if (draggingIndex.value !== index) return;
  draggingIndex.value = null;
  (event.target as HTMLElement).releasePointerCapture(event.pointerId);
}

function nudge(index: number, deltaPercent: number) {
  const pairTotal = widths.value[index] + widths.value[index + 1];
  const min = Math.min(minPercent(), pairTotal / 2);
  const next = Math.min(Math.max(widths.value[index] + deltaPercent, min), pairTotal - min);
  widths.value[index] = next;
  widths.value[index + 1] = pairTotal - next;
}

function resetPair(index: number) {
  const pairTotal = widths.value[index] + widths.value[index + 1];
  widths.value[index] = pairTotal / 2;
  widths.value[index + 1] = pairTotal / 2;
}
</script>

<template>
  <div ref="container" class="split" :class="{ dragging: draggingIndex !== null }">
    <template v-for="n in count" :key="n">
      <section
        class="pane"
        :style="n === count ? undefined : { width: `${widths[n - 1]}%` }"
      >
        <slot :index="n - 1" />
      </section>

      <div
        v-if="n < count"
        class="divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        :aria-valuenow="Math.round(widths[n - 1])"
        aria-valuemin="0"
        aria-valuemax="100"
        tabindex="0"
        @pointerdown="onPointerDown(n - 1, $event)"
        @pointermove="onPointerMove(n - 1, $event)"
        @pointerup="onPointerUp(n - 1, $event)"
        @pointercancel="onPointerUp(n - 1, $event)"
        @dblclick="resetPair(n - 1)"
        @keydown.left.prevent="nudge(n - 1, -2)"
        @keydown.right.prevent="nudge(n - 1, 2)"
        @keydown.home.prevent="resetPair(n - 1)"
      >
        <span class="grip" aria-hidden="true" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.split {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
  overflow: hidden;
  padding: 0 var(--resize-edge) var(--resize-edge) var(--resize-edge);
}

.pane {
  min-width: 0;
  height: 100%;
  overflow: auto;
  background: var(--surface-1);
}

/* Fills whatever every other pane (and every divider) leaves behind. */
.pane:last-of-type {
  flex: 1 1 0;
}

.divider {
  flex: 0 0 auto;
  width: var(--divider-width);
  position: relative;
  background: var(--border);
  cursor: col-resize;
  touch-action: none;
  transition: background-color 0.12s ease;
}

/* Widen the grab target beyond the visible line. */
.divider::before {
  content: "";
  position: absolute;
  inset: 0 -4px;
}

.divider:hover,
.divider:focus-visible,
.dragging .divider {
  background: var(--primary);
  outline: none;
}

.grip {
  position: absolute;
  top: 50%;
  left: 50%;
  translate: -50% -50%;
  width: 2px;
  height: 28px;
  border-radius: 1px;
  background: var(--text-muted);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.divider:hover .grip {
  opacity: 0.6;
}

/* Keep the pointer consistent and stop panes swallowing the drag. */
.dragging {
  cursor: col-resize;
}

.dragging .pane {
  pointer-events: none;
  user-select: none;
}
</style>
