<script setup lang="ts">
/**
 * Generic custom-styled select: a trigger button + a Teleported popover list
 * matching the console's suggestion popover. Built once here rather than
 * relying on a native <select>'s OS-rendered dropdown popup — its light/dark
 * theming isn't reliably controllable via CSS across WebKitGTK/Linux GTK
 * theme integration, which is exactly the "white background in dark mode"
 * bug this replaces.
 */
import { computed, nextTick, ref } from "vue";

export interface DropdownOption {
  id: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: DropdownOption[];
    ariaLabel: string;
    /** "title" matches a panel header's uppercase muted title; "field"
     *  looks like a normal bordered form control (used in Settings). */
    variant?: "title" | "field";
  }>(),
  { variant: "field" },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
const highlightIndex = ref(0);
const triggerEl = ref<HTMLButtonElement | null>(null);
const popoverStyle = ref({ top: "0px", left: "0px", minWidth: "140px" });

const current = computed(
  () => props.options.find((o) => o.id === props.modelValue) ?? props.options[0],
);

async function openMenu() {
  const index = props.options.findIndex((o) => o.id === props.modelValue);
  highlightIndex.value = Math.max(index, 0);
  open.value = true;

  await nextTick();
  const rect = triggerEl.value?.getBoundingClientRect();
  if (rect) {
    popoverStyle.value = {
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      minWidth: `${Math.max(rect.width, 140)}px`,
    };
  }
}

function toggle() {
  if (open.value) open.value = false;
  else void openMenu();
}

function select(id: string) {
  emit("update:modelValue", id);
  open.value = false;
  triggerEl.value?.focus();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    open.value = false;
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (open.value) select(props.options[highlightIndex.value].id);
    else void openMenu();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!open.value) void openMenu();
    else highlightIndex.value = Math.min(highlightIndex.value + 1, props.options.length - 1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!open.value) void openMenu();
    else highlightIndex.value = Math.max(highlightIndex.value - 1, 0);
  }
}
</script>

<template>
  <div class="dropdown">
    <button
      ref="triggerEl"
      type="button"
      class="trigger"
      :class="variant"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-label="ariaLabel"
      @click="toggle"
      @keydown="onKeydown"
      @blur="open = false"
    >
      <span class="label">{{ current?.label }}</span>
      <svg class="chevron" viewBox="0 0 10 6" aria-hidden="true">
        <path d="M1 1l4 4 4-4" />
      </svg>
    </button>

    <Teleport to="body">
      <ul v-if="open" class="popover" role="listbox" :style="popoverStyle">
        <li
          v-for="(option, index) in options"
          :key="option.id"
          role="option"
          :aria-selected="option.id === modelValue"
          :class="{ active: index === highlightIndex, selected: option.id === modelValue }"
          @mousedown.prevent="select(option.id)"
          @mouseenter="highlightIndex = index"
        >
          {{ option.label }}
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.dropdown {
  display: inline-flex;
  min-width: 0;
}

.trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  max-width: 100%;
  font: inherit;
  cursor: pointer;
  color: var(--text-muted);
}

.trigger:focus-visible {
  outline: none;
}

.trigger.title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.trigger.title:hover,
.trigger.title:focus-visible {
  color: var(--text);
}

.trigger.field {
  justify-content: space-between;
  width: 100%;
  min-width: 160px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-1);
  color: var(--text);
  font-size: 13px;
  transition: border-color 0.1s ease;
}

.trigger.field:hover {
  border-color: var(--text-muted);
}

.trigger.field:focus-visible {
  border-color: var(--accent);
  /* Thickens the border on focus without the 1px->2px switch shifting
   * layout, matching Vuetify's outlined-field focus ring. */
  box-shadow: inset 0 0 0 1px var(--accent);
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  flex: 0 0 auto;
  width: 8px;
  height: 5px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.popover {
  position: fixed;
  margin: 0;
  padding: 4px;
  max-height: 260px;
  overflow: auto;
  list-style: none;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 4px;
  /* Vuetify's elevation-8 menu shadow: a soft, layered lift instead of one
   * flat drop shadow. */
  box-shadow:
    0 5px 5px -3px rgb(0 0 0 / 20%),
    0 8px 10px 1px rgb(0 0 0 / 14%),
    0 3px 14px 2px rgb(0 0 0 / 12%);
  z-index: 200;
}

.popover li {
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}

.popover li.active {
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.popover li.selected {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  font-weight: 600;
}
</style>
