import { reactive } from "vue";

/** `id` increments on every call so re-showing the same message still
 *  re-triggers the transition (Vue needs a change to animate on). */
export const toastState = reactive({
  message: null as string | null,
  id: 0,
});

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, durationMs = 2000): void {
  toastState.message = message;
  toastState.id++;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    toastState.message = null;
  }, durationMs);
}
