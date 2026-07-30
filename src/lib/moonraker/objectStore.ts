/**
 * Printer-object discovery, subscription set, and live status cache.
 *
 * Subscription semantics that drive this design (verified in Klipper's
 * klippy/webhooks.py `QueryStatusHelper`): each `printer.objects.subscribe`
 * call *replaces* the connection's entire subscription set — it is not
 * additive. So every expand/collapse resends the full desired set, and the
 * response is an authoritative snapshot of everything subscribed.
 */

import { reactive, watch } from "vue";
import { connectionState, getClient, onNotification } from "./connection";
import type {
  NotifyStatusUpdateParams,
  PrinterObjectsListResult,
  PrinterObjectsSubscribeResult,
} from "./types";

export const objectStoreState = reactive({
  /** Every object the printer exposes, from `printer.objects.list`. */
  objectNames: [] as string[],
  listLoaded: false,
  listLoading: false,
  listError: null as string | null,
  /** Latest known status per object name; only populated while subscribed. */
  status: {} as Record<string, unknown>,
  /** Objects the user has expanded — the set we ask Moonraker to push. */
  subscribedNames: new Set<string>(),
  /** Expanded but awaiting their first snapshot, for per-node spinners. */
  pendingSubscribe: new Set<string>(),
  /**
   * Field/element count per object, from a one-time background batch query
   * (not a subscription) run right after the list loads — lets the tree show
   * a child count before expanding, and refuse to expand objects with none,
   * without waiting on that fetch to show the tree itself.
   */
  childCounts: {} as Record<string, number>,
  childCountsLoaded: false,
});

export async function loadObjectList(): Promise<void> {
  const client = getClient();
  if (!client || objectStoreState.listLoading) return;

  objectStoreState.listLoading = true;
  objectStoreState.listError = null;
  try {
    const result = await client.call<PrinterObjectsListResult>(
      "printer.objects.list",
    );
    const names = Array.isArray(result?.objects) ? result.objects : [];
    objectStoreState.objectNames = [...names].sort((a, b) =>
      a.localeCompare(b),
    );
    objectStoreState.listLoaded = true;
    void loadChildCounts(); // background — doesn't block showing the tree
  } catch (err) {
    objectStoreState.listError =
      err instanceof Error ? err.message : String(err);
  } finally {
    objectStoreState.listLoading = false;
  }
}

/**
 * One-time batch query of every object's full status, purely to count
 * fields/elements per object. Deliberately separate from the live
 * subscribe/status cache above — this snapshot is never merged into
 * `status` and never receives updates; expanding a node still goes through
 * the normal subscribe flow. Measured against a real 282-object printer:
 * ~350ms for the full response — fine in the background, not fine blocking
 * the tree's first render, hence this runs uninvited after `loadObjectList`.
 */
export async function loadChildCounts(): Promise<void> {
  const client = getClient();
  if (!client || objectStoreState.childCountsLoaded) return;
  if (!objectStoreState.objectNames.length) return;

  const objects: Record<string, null> = {};
  for (const name of objectStoreState.objectNames) objects[name] = null;

  try {
    const result = await client.call<PrinterObjectsSubscribeResult>(
      "printer.objects.query",
      { objects },
    );
    const status = result?.status ?? {};
    const counts: Record<string, number> = {};
    for (const name of objectStoreState.objectNames) {
      counts[name] = childCountOf(status[name]);
    }
    objectStoreState.childCounts = counts;
  } catch (err) {
    console.warn("[moonraker] child count query failed", err);
  } finally {
    objectStoreState.childCountsLoaded = true;
  }
}

function childCountOf(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object" && value !== null) return Object.keys(value).length;
  return 0;
}

export async function expandObject(name: string): Promise<void> {
  if (objectStoreState.subscribedNames.has(name)) return;
  objectStoreState.subscribedNames.add(name);
  objectStoreState.pendingSubscribe.add(name);
  await queueSubscribe();
}

export async function collapseObject(name: string): Promise<void> {
  if (!objectStoreState.subscribedNames.has(name)) return;
  objectStoreState.subscribedNames.delete(name);
  objectStoreState.pendingSubscribe.delete(name);
  delete objectStoreState.status[name];
  await queueSubscribe();
}

/**
 * Apply a `notify_status_update` diff. Moonraker replaces whole nested values
 * rather than deep-merging them, so a one-level merge is the correct depth.
 */
export function mergeStatusUpdate(diff: Record<string, unknown>): void {
  for (const [name, fields] of Object.entries(diff)) {
    if (!objectStoreState.subscribedNames.has(name)) continue;

    const current = objectStoreState.status[name];
    if (isPlainObject(current) && isPlainObject(fields)) {
      Object.assign(current, fields);
    } else {
      objectStoreState.status[name] = fields;
    }
  }
}

export function reset(): void {
  objectStoreState.objectNames = [];
  objectStoreState.listLoaded = false;
  objectStoreState.listLoading = false;
  objectStoreState.listError = null;
  objectStoreState.status = {};
  objectStoreState.subscribedNames.clear();
  objectStoreState.pendingSubscribe.clear();
  objectStoreState.childCounts = {};
  objectStoreState.childCountsLoaded = false;
}

// Serialize subscribe calls so rapid expand/collapse can't race: each request
// reflects the set as it stood when its turn came.
let subscribeChain: Promise<void> = Promise.resolve();

function queueSubscribe(): Promise<void> {
  subscribeChain = subscribeChain.then(sendSubscribe, sendSubscribe);
  return subscribeChain;
}

async function sendSubscribe(): Promise<void> {
  const client = getClient();
  const names = [...objectStoreState.subscribedNames];
  if (!client) {
    for (const name of names) objectStoreState.pendingSubscribe.delete(name);
    return;
  }

  // `null` requests every field of an object.
  const objects: Record<string, null> = {};
  for (const name of names) objects[name] = null;

  try {
    const result = await client.call<PrinterObjectsSubscribeResult>(
      "printer.objects.subscribe",
      { objects },
    );
    // Authoritative snapshot of the whole subscribed set.
    objectStoreState.status = { ...(result?.status ?? {}) };
  } catch (err) {
    console.warn("[moonraker] subscribe failed", err);
  } finally {
    for (const name of names) objectStoreState.pendingSubscribe.delete(name);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

onNotification("notify_status_update", (params) => {
  // Params are positional: [statusDiff, eventtime].
  const [diff] = (params ?? []) as Partial<NotifyStatusUpdateParams>;
  if (isPlainObject(diff)) mergeStatusUpdate(diff);
});

// Klipper restarting rebuilds its object set, so re-discover it. It also
// wipes Klipper's own subscription set (klippy/webhooks.py
// QueryStatusHelper is reconstructed from scratch), so anything already in
// `subscribedNames` from before the restart needs to be resent — otherwise
// the tree keeps showing those nodes as expanded with status frozen at its
// last value, since no more `notify_status_update` will arrive for them.
onNotification("notify_klippy_ready", () => {
  if (connectionState.status !== "connected") return;
  void loadObjectList();
  if (objectStoreState.subscribedNames.size) {
    for (const name of objectStoreState.subscribedNames) {
      objectStoreState.pendingSubscribe.add(name);
    }
    void queueSubscribe();
  }
});

// Any drop clears the tree: subscriptions are per-connection and don't survive.
watch(
  () => connectionState.status,
  (status) => {
    if (status !== "connected") reset();
  },
);
