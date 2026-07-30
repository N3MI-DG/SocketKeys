<script setup lang="ts">
/** Replaces a panel header's plain title — picks which frame this pane shows. */
import { computed } from "vue";
import { FRAMES, activeFrame } from "../lib/settings";
import Dropdown from "./Dropdown.vue";

const props = defineProps<{ paneIndex: number }>();

const options = computed(() => FRAMES.value.map((frame) => ({ id: frame.id, label: frame.name })));

const selected = computed({
  get: () => activeFrame.panes[props.paneIndex],
  set: (value: string) => {
    activeFrame.panes[props.paneIndex] = value;
  },
});
</script>

<template>
  <Dropdown
    v-model="selected"
    :options="options"
    variant="title"
    :ariaLabel="`Choose pane ${paneIndex + 1} frame`"
  />
</template>
