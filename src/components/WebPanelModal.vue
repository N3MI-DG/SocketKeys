<script setup lang="ts">
/**
 * Opened from SettingsModal's "Web panels" controls: either its "Add new"
 * option (creates a panel) or its Edit button (reconfigures one) — which
 * mode is just whether `editing` is set, not a separate flag.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ADDR_PLACEHOLDER, addWebPanel, updateWebPanel, type WebPanelDef } from "../lib/webPanels";

const props = defineProps<{ editing: WebPanelDef | null }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [id: string] }>();

const name = ref("");
const address = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

const isEditing = computed(() => props.editing !== null);

// Fresh fields (and focus) every time this reopens, not just on first mount
// — pre-filled from the panel being edited, if any.
watch(open, async (isOpen) => {
  if (!isOpen) return;
  name.value = props.editing?.name ?? "";
  address.value = props.editing?.address ?? "";
  await nextTick();
  nameInput.value?.focus();
});

const canSave = computed(() => name.value.trim().length > 0 && address.value.trim().length > 0);

function close() {
  open.value = false;
}

function save() {
  if (!canSave.value) return;
  let id: string;
  if (props.editing) {
    updateWebPanel(props.editing.id, name.value, address.value);
    id = props.editing.id;
  } else {
    id = addWebPanel(name.value, address.value);
  }
  open.value = false;
  emit("saved", id);
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
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="web-panel-modal-title">
          <div class="modal-header">
            <h2 id="web-panel-modal-title">{{ isEditing ? "Edit web panel" : "Add web panel" }}</h2>
            <button class="icon-btn" type="button" aria-label="Close" @click="close">
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
              </svg>
            </button>
          </div>

          <form class="modal-body" @submit.prevent="save">
            <div class="field">
              <label for="web-panel-name">Name</label>
              <input
                id="web-panel-name"
                ref="nameInput"
                v-model="name"
                type="text"
                class="text-input"
                placeholder="Mainsail"
                autocomplete="off"
              />
            </div>

            <div class="field">
              <label for="web-panel-address">Address</label>
              <input
                id="web-panel-address"
                v-model="address"
                type="text"
                class="text-input"
                :placeholder="`${ADDR_PLACEHOLDER}:8080 or 192.168.1.20:5000`"
                autocomplete="off"
                spellcheck="false"
              />
              <p class="field-hint">
                Use <code>{{ ADDR_PLACEHOLDER }}</code> in place of the printer's IP —
                it's filled in from whatever you're connected to.
              </p>
            </div>

            <div class="actions">
              <button type="button" class="cancel-btn" @click="close">Cancel</button>
              <button type="submit" class="save-btn" :disabled="!canSave">
                {{ isEditing ? "Save" : "Add" }}
              </button>
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
  z-index: 110;
}

.modal {
  width: min(360px, calc(100vw - 48px));
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

.field-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.field-hint code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-2);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
