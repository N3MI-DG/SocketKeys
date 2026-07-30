<script setup lang="ts">
/** Opened from either the Macros panel header's "+ New group" button or a
 *  card's group Dropdown — just a name, modeled on WebPanelModal.vue's chrome. */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { addMacroGroup } from "../../lib/macroGroups";

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [id: string] }>();

const name = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  name.value = "";
  await nextTick();
  nameInput.value?.focus();
});

const canSave = computed(() => name.value.trim().length > 0);

function close() {
  open.value = false;
}

function save() {
  if (!canSave.value) return;
  const id = addMacroGroup(name.value);
  open.value = false;
  emit("created", id);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="backdrop" @mousedown.self="close">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="new-macro-group-title">
          <div class="modal-header">
            <h2 id="new-macro-group-title">New macro group</h2>
            <button class="icon-btn" type="button" aria-label="Close" @click="close">
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
              </svg>
            </button>
          </div>

          <form class="modal-body" @submit.prevent="save">
            <div class="field">
              <label for="macro-group-name">Name</label>
              <input
                id="macro-group-name"
                ref="nameInput"
                v-model="name"
                type="text"
                class="text-input"
                placeholder="My Group"
                autocomplete="off"
              />
            </div>

            <div class="actions">
              <button type="button" class="cancel-btn" @click="close">Cancel</button>
              <button type="submit" class="save-btn" :disabled="!canSave">Add</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 40%);
  z-index: 120;
}

.modal {
  width: min(320px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 30%);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.modal-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.modal-body {
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 13px;
  color: var(--text);
}

.text-input {
  height: 28px;
  padding: 0 10px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.text-input::placeholder {
  color: var(--text-muted);
}

.text-input:focus-visible {
  border-color: var(--accent);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.cancel-btn,
.save-btn {
  height: 28px;
  padding: 0 14px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.cancel-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
}

.cancel-btn:hover {
  border-color: var(--text-muted);
}

.save-btn {
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
}

.save-btn:hover {
  opacity: 0.9;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.icon-btn svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
}

.icon-btn:hover {
  background: var(--surface-3);
  color: var(--text);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
