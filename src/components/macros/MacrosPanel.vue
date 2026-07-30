<script setup lang="ts">
/**
 * Every invokable command, grouped into cards — Klipper's own built-ins
 * automatically (via the bundled klipper-builtins.json, same source
 * ConsolePanel's autocomplete uses), everything else manually (see
 * macroGroups.ts for why: there's no API that says which plugin/class
 * registered a given command).
 */
import { computed, onMounted, ref, watch } from "vue";
import { connectionState } from "../../lib/moonraker/connection";
import {
  consoleState,
  ensureMacroSourceLoaded,
  getBuiltinInfo,
  getMacroParams,
  isKnownMacro,
  loadGcodeHelp,
  type MacroParam,
} from "../../lib/moonraker/console";
import {
  assignCommandGroup,
  collapsedMacroSections,
  commandGroupAssignments,
  macroGroups,
  removeMacroGroup,
  toggleMacroSectionCollapsed,
} from "../../lib/macroGroups";
import FrameDropdown from "../FrameDropdown.vue";
import MacroCard from "./MacroCard.vue";
import MacroGroupDropZones from "./MacroGroupDropZones.vue";
import NewMacroGroupModal from "./NewMacroGroupModal.vue";

defineProps<{ paneIndex: number }>();

const connected = computed(() => connectionState.status === "connected");

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

function loadIfNeeded() {
  if (!connected.value) return;
  if (!Object.keys(consoleState.gcodeHelp).length) void loadGcodeHelp();
  void ensureMacroSourceLoaded();
}

onMounted(loadIfNeeded);
watch(() => connectionState.status, loadIfNeeded);

interface MacroEntry {
  name: string;
  help: string;
  params: MacroParam[] | null;
  isBuiltin: boolean;
}

// Underscore-prefixed names are Klipper/Mainsail's own convention for
// internal/hidden macros (AFC uses it too, e.g. _AFC_GLOBAL_VARS) — not
// meant to be run directly, so left out of the button grid entirely.
const entries = computed<MacroEntry[]>(() =>
  Object.keys(consoleState.gcodeHelp)
    .filter((name) => !name.startsWith("_"))
    .map((name): MacroEntry => {
      const builtin = getBuiltinInfo(name);
      if (builtin) {
        return {
          name,
          help: builtin.description || consoleState.gcodeHelp[name] || "",
          params: builtin.params.map((param) => ({
            name: param.name,
            default: null,
            type: param.optional ? null : "required",
          })),
          isBuiltin: true,
        };
      }
      return {
        name,
        help: consoleState.gcodeHelp[name] ?? "",
        params: isKnownMacro(name) ? getMacroParams(name) : null,
        isBuiltin: false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name)),
);

/** `null` unless `name` is assigned to a group that still exists — a
 *  deleted group's former members should read as plain Ungrouped, not
 *  carry a dangling id down into MacroCard's Dropdown. */
function resolvedGroupId(name: string): string | null {
  const id = commandGroupAssignments[name];
  return id && macroGroups.some((group) => group.id === id) ? id : null;
}

interface GroupSection {
  id: string;
  label: string;
  entries: MacroEntry[];
  removable: boolean;
}

// Custom groups (creation order) first, then Ungrouped, then Klipper last —
// Klipper's built-ins are usually the largest, least-novel bucket.
const sections = computed<GroupSection[]>(() => {
  const byGroup = new Map<string, MacroEntry[]>();
  const klipperEntries: MacroEntry[] = [];
  const ungrouped: MacroEntry[] = [];

  for (const entry of entries.value) {
    if (entry.isBuiltin) {
      klipperEntries.push(entry);
      continue;
    }
    const groupId = resolvedGroupId(entry.name);
    if (groupId) {
      const list = byGroup.get(groupId) ?? [];
      list.push(entry);
      byGroup.set(groupId, list);
    } else {
      ungrouped.push(entry);
    }
  }

  // Every custom group renders even with zero members — otherwise creating
  // one has no visible effect until a macro's actually dropped into it.
  const result: GroupSection[] = macroGroups.map((group) => ({
    id: group.id,
    label: group.name,
    entries: byGroup.get(group.id) ?? [],
    removable: true,
  }));

  if (ungrouped.length) {
    result.push({ id: "ungrouped", label: "Ungrouped", entries: ungrouped, removable: false });
  }
  if (klipperEntries.length) {
    result.push({ id: "klipper", label: "Klipper", entries: klipperEntries, removable: false });
  }
  return result;
});

const newGroupModalOpen = ref(false);
/** Set when the modal was opened from a card's "+ New group…" option, so
 *  the freshly-created group gets assigned to that command right away. */
const pendingAssignCommand = ref<string | null>(null);

function openNewGroupModal(forCommand: string | null = null) {
  pendingAssignCommand.value = forCommand;
  newGroupModalOpen.value = true;
}

function onGroupCreated(id: string) {
  if (pendingAssignCommand.value) {
    assignCommandGroup(pendingAssignCommand.value, id);
    pendingAssignCommand.value = null;
  }
}


</script>

<template>
  <div class="macros-panel">
    <div class="panel-header">
      <FrameDropdown :pane-index="paneIndex" />
      <div class="controls">
        <button
          type="button"
          class="icon-btn"
          title="New macro group"
          aria-label="New macro group"
          @click="openNewGroupModal()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>

    <div class="content">
      <p v-if="!connected" class="notice">{{ placeholder }}</p>
      <p v-else-if="!entries.length" class="notice">No commands reported.</p>

      <template v-else>
        <section v-for="section in sections" :key="section.id" class="group-section">
          <div class="group-header">
            <span class="group-title">{{ section.label }}</span>
            <div class="header-actions">
              <button
                v-if="section.removable"
                type="button"
                class="remove-group-btn"
                title="Remove group"
                aria-label="Remove group"
                @click="removeMacroGroup(section.id)"
              >
                <svg viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
                </svg>
              </button>
              <button
                type="button"
                class="collapse-btn"
                :class="{ collapsed: collapsedMacroSections.has(section.id) }"
                :aria-expanded="!collapsedMacroSections.has(section.id)"
                :aria-label="collapsedMacroSections.has(section.id) ? 'Expand group' : 'Collapse group'"
                @click="toggleMacroSectionCollapsed(section.id)"
              >
                <svg viewBox="0 0 10 6" aria-hidden="true">
                  <path d="M1 1l4 4 4-4" />
                </svg>
              </button>
            </div>
          </div>

          <div v-if="!collapsedMacroSections.has(section.id)" class="card-grid">
            <MacroCard
              v-for="entry in section.entries"
              :key="entry.name"
              :name="entry.name"
              :help="entry.help"
              :params="entry.params"
              :is-builtin="entry.isBuiltin"
              :current-group-id="resolvedGroupId(entry.name)"
              @request-new-group="openNewGroupModal(entry.name)"
            />
          </div>
        </section>
      </template>
    </div>

    <NewMacroGroupModal v-model="newGroupModalOpen" @created="onGroupCreated" />
    <MacroGroupDropZones @request-new-group="openNewGroupModal" />
  </div>
</template>

<style scoped>
.macros-panel {
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

.controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.icon-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}

.icon-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.notice {
  margin: 0;
  padding: 16px;
  font-size: 13px;
  color: var(--text-muted);
}

.content {
  flex: 1 1 auto;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.group-section:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.remove-group-btn,
.collapse-btn {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 4px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.remove-group-btn svg {
  width: 8px;
  height: 8px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
}

.remove-group-btn:hover {
  background: var(--surface-3);
  color: var(--error);
}

.collapse-btn svg {
  width: 9px;
  height: 6px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.12s ease;
}

.collapse-btn.collapsed svg {
  transform: rotate(-90deg);
}

.collapse-btn:hover {
  background: var(--surface-3);
  color: var(--text);
}

.card-grid {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: center;
  gap: 6px;
}

</style>
