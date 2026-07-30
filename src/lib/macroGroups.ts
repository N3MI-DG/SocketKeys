/**
 * User-defined macro groups, and which group each command is sorted into.
 * There's no API to learn which plugin/class actually registered a given
 * command (confirmed against Klipper's and Moonraker's own source — see the
 * Macros panel's plan notes), so grouping beyond Klipper's own built-ins
 * (identified separately via klipper-builtins.json) is entirely manual:
 * everything starts "Ungrouped" until sorted here, once, by hand.
 */
import { reactive, watch } from "vue";

export interface MacroGroupDef {
  id: string;
  name: string;
}

const GROUPS_KEY = "socketkeys.macroGroups.v1";
const ASSIGNMENTS_KEY = "socketkeys.macroGroupAssignments.v1";

function isMacroGroupDef(value: unknown): value is MacroGroupDef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && v.id.length > 0 && typeof v.name === "string" && v.name.length > 0;
}

function loadGroups(): MacroGroupDef[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isMacroGroupDef) : [];
  } catch {
    return []; // malformed storage — start clean rather than crash
  }
}

function loadAssignments(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ASSIGNMENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [command, groupId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof groupId === "string" && groupId.length > 0) result[command] = groupId;
    }
    return result;
  } catch {
    return {};
  }
}

export const macroGroups = reactive<MacroGroupDef[]>(loadGroups());
export const commandGroupAssignments = reactive<Record<string, string>>(loadAssignments());

watch(
  () => [...macroGroups],
  (groups) => localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)),
);

watch(
  () => ({ ...commandGroupAssignments }),
  (assignments) => localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments)),
);

/** Adds a group and returns its generated id, so the caller can assign a
 *  command to it right away instead of leaving the user to hunt for it. */
export function addMacroGroup(name: string): string {
  const id = `macrogroup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  macroGroups.push({ id, name: name.trim() });
  return id;
}

/** Removes a group; any commands assigned to it fall back to Ungrouped
 *  rather than pointing at a dangling id. */
export function removeMacroGroup(id: string): void {
  const index = macroGroups.findIndex((group) => group.id === id);
  if (index !== -1) macroGroups.splice(index, 1);
  for (const [command, groupId] of Object.entries(commandGroupAssignments)) {
    if (groupId === id) delete commandGroupAssignments[command];
  }
}

/** `null` moves a command back to Ungrouped. */
export function assignCommandGroup(command: string, groupId: string | null): void {
  if (groupId === null) delete commandGroupAssignments[command];
  else commandGroupAssignments[command] = groupId;
}

/** Shared during a macro button's drag (see MacroCard.vue's dragstart/
 *  dragend), so MacrosPanel can show a "drop on a category" bar without
 *  prop-drilling the dragged command through every group section. `null`
 *  whenever no drag is in progress. */
export const macroDragState = reactive<{ command: string | null }>({ command: null });

const COLLAPSED_SECTIONS_KEY = "socketkeys.macroGroups.collapsedSections.v1";

function loadCollapsedSections(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string"))
      : new Set();
  } catch {
    return new Set(); // malformed storage — start clean rather than crash
  }
}

/** Which group sections are collapsed in the Macros panel — including the
 *  synthetic "ungrouped"/"klipper" section ids, not just real group ids.
 *  A module-level singleton (rather than component state) so it survives
 *  both switching away from the Macros panel and back, and an app restart. */
export const collapsedMacroSections = reactive(loadCollapsedSections());

watch(
  () => [...collapsedMacroSections],
  (ids) => localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(ids)),
);

export function toggleMacroSectionCollapsed(id: string): void {
  if (collapsedMacroSections.has(id)) collapsedMacroSections.delete(id);
  else collapsedMacroSections.add(id);
}
