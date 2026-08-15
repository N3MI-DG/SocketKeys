import { nextTick, watch, type Ref, type WatchSource } from "vue";

/**
 * Auto-follows new content appended to a scrollable element, but only while
 * it was already scrolled to (near) the bottom right before the update.
 * Deliberately reads scroll position fresh on each trigger rather than
 * tracking it via a separate `scroll` listener: a burst of rapid updates
 * (several pushes within milliseconds) can let that listener's own
 * `scrollTop` assignment race the *next* update's DOM patch — by the time
 * its resulting `scroll` event actually fired, `scrollHeight` had already
 * grown past what it accounted for, so it read a stale distance-from-bottom,
 * wrongly concluded the user had scrolled away, and silently disabled
 * auto-scroll for good. Reading fresh here, synchronously before the
 * `await nextTick()` below (the watcher runs pre-flush, so the DOM still
 * reflects the state from before this update), can't drift out of sync with
 * what actually changed.
 *
 * Returns `pinNext`, for callers that need to force the next update to snap
 * to the bottom regardless of current scroll position — e.g. the logs panel
 * opening a different file, which should always start pinned to its tail
 * rather than wherever the previous file's scroll happened to be.
 */
export function useAutoScroll(
  el: Ref<HTMLElement | null>,
  source: WatchSource<unknown>,
  deep = false,
) {
  let forcePinNext = false;

  watch(
    source,
    async () => {
      const node = el.value;
      if (!node) return;
      const wasPinned =
        forcePinNext || node.scrollHeight - node.scrollTop - node.clientHeight < 24;
      forcePinNext = false;
      if (!wasPinned) return;
      await nextTick();
      node.scrollTop = node.scrollHeight;
    },
    { deep },
  );

  return {
    pinNext: () => {
      forcePinNext = true;
    },
  };
}
