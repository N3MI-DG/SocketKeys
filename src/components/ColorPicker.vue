<script setup lang="ts">
/**
 * Preset swatches + a native `<input type="color">` for the one-off case.
 * `modelValue` of `null` means "no override, use the theme default" — shown
 * as an outlined swatch rather than a filled one so it reads as distinct
 * from actually picking that color.
 */
import { computed } from "vue";

const props = defineProps<{
  modelValue: string | null;
  ariaLabel: string;
  /** CSS custom property this picker overrides — read via getComputedStyle
   *  so the "default" swatch and the custom-picker's starting position show
   *  the theme's actual current value instead of a guess baked in here. */
  cssVar: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();

const PRESETS = [
  "#3b7de0", // blue
  "#7c5cff", // violet
  "#d63384", // pink
  "#c8342f", // red
  "#e3672e", // orange
  "#c99a1e", // gold
  "#1a7f37", // green
  "#0d9488", // teal
];

const isCustom = computed(
  () => props.modelValue !== null && !PRESETS.includes(props.modelValue),
);

// The native picker needs some starting color even before the user has ever
// touched it — the theme's current value for this variable is the sanest
// choice, read live rather than guessed so it tracks light/dark switches.
const themeDefault = computed(
  () => getComputedStyle(document.documentElement).getPropertyValue(props.cssVar).trim() || "#888888",
);

function onCustomInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="color-picker">
    <!--
      Both of these are conditional/variable-width, and both go *before* the
      fixed swatch row rather than after. The parent `.field` row is
      `justify-content: space-between`, which right-anchors this whole
      component — so anything that changes this component's width ends up
      shifting its *left* edge instead, and content after that point (i.e.
      the swatches, if these lived there) visibly slides sideways. Leading
      with the variable-width parts means only they absorb that edge
      movement; the swatch row's position relative to this component's
      right edge — and thus on screen — never changes.
    -->
    <button
      v-if="modelValue !== null"
      type="button"
      class="reset-btn"
      @click="emit('update:modelValue', null)"
    >
      Reset
    </button>

    <!-- The custom trigger below is a fixed rainbow icon, so once a custom
         (i.e. non-preset) color is active, show what was actually picked
         here — a preset's own swatch already does this job for preset picks. -->
    <span v-if="isCustom" class="preview" :style="{ background: modelValue! }" />

    <button
      v-for="color in PRESETS"
      :key="color"
      type="button"
      class="swatch"
      :class="{ selected: modelValue === color }"
      :style="{ background: color }"
      :aria-label="`${ariaLabel}: ${color}`"
      :aria-pressed="modelValue === color"
      @click="emit('update:modelValue', color)"
    />

    <label
      class="swatch custom"
      :class="{ selected: isCustom }"
      title="Custom color"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 3v10M3 8h10" />
      </svg>
      <input
        type="color"
        class="native-input"
        :value="modelValue ?? themeDefault"
        :aria-label="`${ariaLabel}: custom color value`"
        @input="onCustomInput"
      />
    </label>
  </div>
</template>

<style scoped>
.color-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.swatch {
  position: relative;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  cursor: pointer;
}

.swatch.selected {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}

.swatch.custom {
  display: grid;
  place-items: center;
  overflow: hidden;
  /* A fixed rainbow swatch (rather than mirroring whatever custom color is
   * picked) so this control still reads as "open a picker" even once a
   * custom color is active — a solid fill here would look like just another
   * preset dot, which was the actual complaint. */
  background: conic-gradient(
    from 90deg,
    #ff5252,
    #ffb300,
    #ffee58,
    #66bb6a,
    #29b6f6,
    #7e57c2,
    #ff5252
  );
}

.swatch.custom svg {
  width: 9px;
  height: 9px;
  fill: none;
  stroke: #fff;
  stroke-width: 1.8;
  stroke-linecap: round;
  filter: drop-shadow(0 0 1.5px rgb(0 0 0 / 70%));
  pointer-events: none;
}

.preview {
  width: 14px;
  height: 14px;
  border: 1px solid var(--border);
  border-radius: 50%;
}

.native-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}

.reset-btn {
  height: 20px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.reset-btn:hover {
  background: var(--surface-3);
  color: var(--text);
}
</style>
