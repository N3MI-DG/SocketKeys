<script setup lang="ts">
/**
 * A split-pill button, modeled directly on Mainsail's own MacroButton.vue:
 * a filled primary-color name button that always sends the bare command
 * immediately, plus — only when there's something to configure — a narrow
 * chevron segment that opens a floating popover with the argument fields
 * and its own Send button. The name button never carries params itself;
 * that's Mainsail's actual behavior (`doSendMacro` always sends
 * `macro.name` alone), not an oversight here.
 *
 * Params only ever show as real named-param fields — no free-text "guess
 * the arguments" field. A macro that forwards `{rawparams}` (or that the
 * params.NAME regex just missed) reports zero *found* params without
 * necessarily meaning zero arguments, but there's nothing to build a
 * trustworthy input for in that case, so it gets no param fields at all,
 * same as a plugin's Python-registered command with no discoverable schema.
 *
 * The chevron still opens for a param-less *custom* macro, though — that
 * popover is also the only place to reach the group picker (below), not a
 * Mainsail concept, SocketKeys' own addition. A *builtin* with a confirmed-
 * empty param list (from the maintained bundled reference, so trusted, and
 * never groupable anyway) skips the chevron entirely.
 */
import { computed, nextTick, onUnmounted, reactive, ref, watch } from "vue";
import { sendCommand, type MacroParam } from "../../lib/moonraker/console";
import { assignCommandGroup, macroDragState, macroGroups } from "../../lib/macroGroups";
import Dropdown from "../Dropdown.vue";

const props = defineProps<{
  name: string;
  help: string;
  params: MacroParam[] | null;
  isBuiltin: boolean;
  /** `null` = Ungrouped. Ignored (and the group picker hidden) for builtins
   *  — those belong to the fixed "Klipper" group, not reassignable. */
  currentGroupId: string | null;
}>();

const emit = defineEmits<{ requestNewGroup: [] }>();

/** Underscores read as spaces, same as Mainsail's own macro buttons. */
const displayName = computed(() => props.name.replace(/_/g, " "));

const hasKnownParams = computed(() => (props.params?.length ?? 0) > 0);
const hasChevron = computed(() => hasKnownParams.value || !props.isBuiltin);

const expanded = ref(false);
const paramValues = reactive<Record<string, string>>({});

// Pre-fill each field with whatever default getMacroParams found, so the
// form shows what would actually run if the user changes nothing.
watch(
  () => props.params,
  (params) => {
    for (const key of Object.keys(paramValues)) delete paramValues[key];
    for (const param of params ?? []) {
      if (param.default !== null) paramValues[param.name] = param.default;
    }
  },
  { immediate: true },
);

const chevronEl = ref<HTMLButtonElement | null>(null);
const popoverEl = ref<HTMLElement | null>(null);
const popoverStyle = ref({ top: "0px", left: "0px" });

async function openPopover() {
  expanded.value = true;
  await nextTick();
  const rect = chevronEl.value?.getBoundingClientRect();
  if (rect) {
    popoverStyle.value = { top: `${rect.bottom + 4}px`, left: `${rect.left}px` };
  }
}

function closePopover() {
  expanded.value = false;
}

function toggleExpand() {
  if (!hasChevron.value) return;
  if (expanded.value) closePopover();
  else void openPopover();
}

// A Teleported popover holding real inputs can't rely on blur-to-close
// (Dropdown.vue's trick) the way an options list can — focusing one of
// those inputs *is* a blur of the chevron. Outside-click + Escape instead.
function onDocumentMousedown(event: MouseEvent) {
  const target = event.target as Node;
  if (popoverEl.value?.contains(target) || chevronEl.value?.contains(target)) return;
  closePopover();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closePopover();
}

watch(expanded, (isOpen) => {
  if (isOpen) {
    document.addEventListener("mousedown", onDocumentMousedown);
    document.addEventListener("keydown", onDocumentKeydown);
  } else {
    document.removeEventListener("mousedown", onDocumentMousedown);
    document.removeEventListener("keydown", onDocumentKeydown);
  }
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDocumentMousedown);
  document.removeEventListener("keydown", onDocumentKeydown);
});

function runBare() {
  void sendCommand(props.name);
}

// Only the name segment is draggable (not the chevron/popover) — a plain
// click-without-move still reaches `runBare` normally, since the browser
// only fires dragstart once the pointer actually moves while held down.
function onDragStart(event: DragEvent) {
  event.dataTransfer?.setData("text/plain", props.name);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  macroDragState.command = props.name;
}

function onDragEnd() {
  macroDragState.command = null;
}

function sendWithParams() {
  const parts = [props.name];
  for (const param of props.params ?? []) {
    const value = paramValues[param.name]?.trim();
    if (value) parts.push(`${param.name}=${value}`);
  }
  void sendCommand(parts.join(" "));
  // Deliberately left open on send, same as Mainsail's own menu (its
  // `sendWithParams` never closes it either) — sending again with a
  // tweaked value shouldn't need reopening the popover each time.
}

const UNGROUPED_ID = "__ungrouped__";
const ADD_NEW_ID = "__add_new__";

const groupOptions = computed(() => [
  { id: UNGROUPED_ID, label: "Ungrouped" },
  ...macroGroups.map((group) => ({ id: group.id, label: group.name })),
  { id: ADD_NEW_ID, label: "+ New group…" },
]);

const groupSelectionModel = computed({
  get: () => props.currentGroupId ?? UNGROUPED_ID,
  set: (id: string) => {
    if (id === ADD_NEW_ID) {
      emit("requestNewGroup");
      return;
    }
    assignCommandGroup(props.name, id === UNGROUPED_ID ? null : id);
  },
});
</script>

<template>
  <div class="macro-btn-group">
    <button
      type="button"
      class="name-btn"
      :class="{ 'has-chevron': hasChevron }"
      :title="help || undefined"
      :draggable="!isBuiltin"
      @click="runBare"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
    >
      {{ displayName }}
    </button>
    <button
      v-if="hasChevron"
      ref="chevronEl"
      type="button"
      class="chevron-btn"
      :aria-expanded="expanded"
      :aria-label="expanded ? 'Hide parameters' : 'Show parameters'"
      @click="toggleExpand"
    >
      <svg viewBox="0 0 10 6" aria-hidden="true">
        <path d="M1 1l4 4 4-4" />
      </svg>
    </button>

    <Teleport to="body">
      <div v-if="expanded" ref="popoverEl" class="popover" :style="popoverStyle">
        <p v-if="help" class="help-text">{{ help }}</p>

        <div v-if="hasKnownParams" class="params">
          <div v-for="param in params" :key="param.name" class="param-field">
            <label :for="`${name}-${param.name}`">
              {{ param.name }}
              <span v-if="param.type" class="param-type">{{ param.type }}</span>
            </label>
            <input
              :id="`${name}-${param.name}`"
              v-model="paramValues[param.name]"
              type="text"
              class="text-input"
              :placeholder="param.default ?? ''"
              autocomplete="off"
              spellcheck="false"
              @keyup.enter="sendWithParams"
            />
          </div>
        </div>

        <Dropdown
          v-if="!isBuiltin"
          v-model="groupSelectionModel"
          :options="groupOptions"
          variant="field"
          ariaLabel="Macro group"
        />

        <button v-if="hasKnownParams" type="button" class="send-btn" @click="sendWithParams">
          Send
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.macro-btn-group {
  display: inline-flex;
  border-radius: 5px;
  overflow: hidden;
}

.name-btn {
  padding: 6px 12px;
  border: 0;
  border-radius: 5px;
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.name-btn.has-chevron {
  border-radius: 5px 0 0 5px;
}

.name-btn:hover {
  opacity: 0.9;
}

.chevron-btn {
  flex: 0 0 auto;
  width: 22px;
  display: grid;
  place-items: center;
  border: 0;
  border-left: 1px solid rgb(255 255 255 / 30%);
  border-radius: 0 5px 5px 0;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.chevron-btn:hover {
  opacity: 0.9;
}

.chevron-btn svg {
  width: 8px;
  height: 5px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.popover {
  position: fixed;
  z-index: 130;
  width: 220px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 25%);
}

.help-text {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.params {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.param-field label {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.param-type {
  font-size: 10px;
  color: var(--accent);
}

.text-input {
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  outline: none;
}

.text-input::placeholder {
  color: var(--text-muted);
}

.text-input:focus-visible {
  border-color: var(--accent);
}

.send-btn {
  height: 26px;
  padding: 0 12px;
  border-radius: 5px;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.send-btn:hover {
  opacity: 0.9;
}
</style>
