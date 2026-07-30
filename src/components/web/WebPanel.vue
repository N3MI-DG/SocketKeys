<script setup lang="ts">
/**
 * Renders the web panel (see webPanels.ts) identified by `frameId` — every
 * one of them, including the default "Web Interface" entry, is just data;
 * there's no built-in/custom distinction left in this component. A panel
 * whose address uses the `*addr*` placeholder waits for the Moonraker
 * connection (to substitute a real host); one that doesn't is just a
 * bookmark, and shows immediately regardless of connection state.
 */
import { computed } from "vue";
import { connectedHost, connectionState } from "../../lib/moonraker/connection";
import { getWebPanel, resolveWebPanelUrl, usesConnectedAddress } from "../../lib/webPanels";
import FrameDropdown from "../FrameDropdown.vue";

const props = defineProps<{ paneIndex: number; frameId: string }>();

const panel = computed(() => getWebPanel(props.frameId));

const connected = computed(() => connectionState.status === "connected");

const needsConnection = computed(
  () => panel.value !== undefined && usesConnectedAddress(panel.value.address),
);
const ready = computed(() => !needsConnection.value || connected.value);

const webUrl = computed(() => {
  if (!panel.value) return null;
  return resolveWebPanelUrl(panel.value.address, connected.value ? connectedHost() : null);
});

const placeholder = computed(() => {
  switch (connectionState.status) {
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return connectionState.error ?? "Reconnecting…";
    case "error":
      return connectionState.error ?? "Connection failed";
    default:
      return "Not connected";
  }
});
</script>

<template>
  <div class="web-panel">
    <div class="panel-header">
      <FrameDropdown :pane-index="paneIndex" />
    </div>

    <p v-if="!ready || !webUrl" class="notice">{{ placeholder }}</p>
    <iframe
      v-else
      class="web-frame"
      :src="webUrl"
      :title="panel?.name ?? 'Web panel'"
    />
  </div>
</template>

<style scoped>
.web-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  flex: 0 0 auto;
  height: var(--panel-header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--border);
}

.notice {
  margin: 0;
  padding: 16px;
  font-size: 13px;
  color: var(--text-muted);
}

.web-frame {
  flex: 1 1 auto;
  width: 100%;
  border: 0;
  background: #fff;
}
</style>
