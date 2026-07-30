<script setup lang="ts">
/**
 * One row of the object tree, recursing into itself for children.
 *
 * Two modes share one component:
 *  - `object-root`: a top-level printer object. Expanding subscribes to it,
 *    collapsing unsubscribes — this is what drives live updates.
 *  - `value`: any JSON value inside an already-subscribed object. Expanding is
 *    purely local, since Moonraker can't subscribe below object granularity.
 */
import { computed, ref } from "vue";
import {
  collapseObject,
  expandObject,
  objectStoreState,
} from "../../lib/moonraker/objectStore";
import { buildMacroVariable } from "../../lib/macroVariable";
import { copyToClipboard } from "../../lib/clipboard";
import { showToast } from "../../lib/toast";

const props = withDefaults(
  defineProps<{
    label: string;
    kind?: "object-root" | "value";
    value?: unknown;
    depth?: number;
    /** Ancestor keys from the root object down to (not including) this node. */
    path?: string[];
  }>(),
  { kind: "value", depth: 0, path: () => [] },
);

/** This node's own full key chain, for building its macro-variable reference
 *  and for handing down to children as their `path`. */
const ownPath = computed(() => [...props.path, props.label]);
const macroVariable = computed(() => buildMacroVariable(ownPath.value));

async function copyMacroVariable() {
  const ok = await copyToClipboard(macroVariable.value);
  showToast(ok ? "Copied to clipboard" : "Couldn't copy to clipboard");
}

/** Guards against pathological nesting; real Klipper data is far shallower. */
const MAX_DEPTH = 20;
/** Keeps dense data (e.g. a large bed_mesh matrix) from flooding the DOM. */
const MAX_CHILDREN = 200;

const localExpanded = ref(false);

const isRoot = computed(() => props.kind === "object-root");

const expanded = computed(() =>
  isRoot.value
    ? objectStoreState.subscribedNames.has(props.label)
    : localExpanded.value,
);

const loading = computed(
  () => isRoot.value && objectStoreState.pendingSubscribe.has(props.label),
);

/** Root nodes read live status from the store; value nodes use their prop. */
const resolvedValue = computed(() =>
  isRoot.value ? objectStoreState.status[props.label] : props.value,
);

const valueKind = computed<"object" | "array" | "scalar">(() => {
  const value = resolvedValue.value;
  if (Array.isArray(value)) return "array";
  if (typeof value === "object" && value !== null) return "object";
  return "scalar";
});

/** Known from a one-time background count query, keyed by object name —
 *  `undefined` while that query hasn't reached this object yet. */
const rootChildCount = computed(() =>
  isRoot.value ? objectStoreState.childCounts[props.label] : undefined,
);

/** Pre-formatted here rather than in the template: a literal "}}" inside a
 *  mustache expression trips up Vue's interpolation-close scanner, since it
 *  just looks for the first "}}" rather than actually parsing the JS. */
const rootChildCountLabel = computed(() =>
  rootChildCount.value ? `{${rootChildCount.value}}` : "",
);

const expandable = computed(() => {
  if (isRoot.value) {
    // Count not in yet — stay optimistically expandable rather than flash
    // "no children" for something that may well turn out to have some.
    if (rootChildCount.value === undefined) return true;
    return rootChildCount.value > 0;
  }
  return valueKind.value !== "scalar" && props.depth < MAX_DEPTH;
});

const children = computed<{ label: string; value: unknown }[]>(() => {
  if (!expanded.value) return [];
  const value = resolvedValue.value;

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_CHILDREN)
      .map((entry, index) => ({ label: String(index), value: entry }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .slice(0, MAX_CHILDREN)
      .map(([key, entry]) => ({ label: key, value: entry }));
  }
  return [];
});

const truncatedCount = computed(() => {
  if (!expanded.value) return 0;
  const value = resolvedValue.value;
  const total = Array.isArray(value)
    ? value.length
    : typeof value === "object" && value !== null
      ? Object.keys(value).length
      : 0;
  return Math.max(0, total - MAX_CHILDREN);
});

/** Short inline preview so collapsed branches still say something useful. */
const summary = computed(() => {
  const value = resolvedValue.value;
  if (isRoot.value && !expanded.value) return "";
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).length}}`;
  }
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "number") {
    // Trim float noise like 24.299999999999997 without lying about integers.
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  return String(value);
});

const scalarClass = computed(() => {
  const value = resolvedValue.value;
  if (typeof value === "number") return "num";
  if (typeof value === "string") return "str";
  if (typeof value === "boolean") return "bool";
  if (value === null || value === undefined) return "nil";
  return "";
});

function toggle() {
  if (!expandable.value) return;

  if (isRoot.value) {
    if (expanded.value) void collapseObject(props.label);
    else void expandObject(props.label);
    return;
  }
  localExpanded.value = !localExpanded.value;
}
</script>

<template>
  <li class="node">
    <div
      class="row"
      :class="{ expandable, root: isRoot }"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      role="treeitem"
      :aria-expanded="expandable ? expanded : undefined"
      :tabindex="expandable ? 0 : -1"
      :title="macroVariable"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
      @contextmenu.prevent="copyMacroVariable"
    >
      <span class="arrow" :class="{ open: expanded, hidden: !expandable }">
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3.5 1.5 L7 5 L3.5 8.5" />
        </svg>
      </span>

      <span class="label">{{ label }}</span>

      <span v-if="loading" class="meta">loading…</span>
      <span v-else-if="isRoot && !expanded && rootChildCountLabel" class="value">
        {{ rootChildCountLabel }}
      </span>
      <span v-else-if="summary" class="value" :class="scalarClass">
        {{ summary }}
      </span>
    </div>

    <ul v-if="expanded && children.length" class="children" role="group">
      <TreeNode
        v-for="child in children"
        :key="child.label"
        :label="child.label"
        kind="value"
        :value="child.value"
        :depth="depth + 1"
        :path="ownPath"
      />
      <li v-if="truncatedCount" class="more" :style="{ paddingLeft: `${(depth + 1) * 12 + 20}px` }">
        +{{ truncatedCount }} more
      </li>
    </ul>
  </li>
</template>

<style scoped>
.node {
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding-right: 8px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap;
  border-radius: 3px;
}

.row.expandable {
  cursor: pointer;
}

.row.expandable:hover {
  background: var(--surface-2);
}

.row:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.arrow {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  transition: transform 0.12s ease;
}

.arrow.open {
  transform: rotate(90deg);
}

.arrow.hidden {
  visibility: hidden;
}

.arrow svg {
  width: 8px;
  height: 8px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.label {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
}

.row.root .label {
  font-weight: 600;
}

.value {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

.value.num {
  color: var(--accent);
}

.value.bool,
.value.nil {
  font-style: italic;
}

.meta {
  color: var(--text-muted);
  font-style: italic;
}

.children {
  margin: 0;
  padding: 0;
}

.more {
  list-style: none;
  min-height: 22px;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-style: italic;
  color: var(--text-muted);
}
</style>
