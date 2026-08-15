<script setup lang="ts">
/** Generic confirm/cancel dialog, modeled on NewMacroGroupModal.vue's chrome
 *  — for actions worth a pause before firing (e.g. logs panel's rollover,
 *  which restarts Klipper). */
import { onMounted, onUnmounted } from "vue";

const open = defineModel<boolean>({ required: true });
const props = withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Styles the confirm button to signal a disruptive/destructive action. */
    danger?: boolean;
  }>(),
  { confirmLabel: "Confirm", cancelLabel: "Cancel", danger: false },
);
const emit = defineEmits<{ confirm: [] }>();

function close() {
  open.value = false;
}

function confirm() {
  open.value = false;
  emit("confirm");
}

function onKeydown(event: KeyboardEvent) {
  if (open.value && event.key === "Escape") close();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="backdrop" @mousedown.self="close">
        <div
          class="modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          aria-describedby="confirm-modal-message"
        >
          <div class="modal-header">
            <h2 id="confirm-modal-title">{{ title }}</h2>
            <button class="icon-btn" type="button" aria-label="Close" @click="close">
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
              </svg>
            </button>
          </div>

          <div class="modal-body">
            <p id="confirm-modal-message">{{ message }}</p>
            <div class="actions">
              <button type="button" class="cancel-btn" @click="close">
                {{ cancelLabel }}
              </button>
              <button
                type="button"
                class="confirm-btn"
                :class="{ danger: props.danger }"
                @click="confirm"
              >
                {{ confirmLabel }}
              </button>
            </div>
          </div>
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

.modal-body p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.cancel-btn,
.confirm-btn {
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

.confirm-btn {
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
}

.confirm-btn.danger {
  border-color: var(--warning);
  background: var(--warning);
}

.confirm-btn:hover {
  opacity: 0.9;
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
