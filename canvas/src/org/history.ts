import { reactive } from 'vue';
import type { Overlay } from '../../../src/schema/overlay.js';

export type PlanFields = Pick<
  Overlay,
  'plannedOrder' | 'plannedPages' | 'plannedDeletions' | 'layout' | 'linkEdits' | 'addedLinks'
>;

/** Snapshot history over the six plan fields. The caller applies the snapshots undo/redo return. */
export function createHistory(read: () => PlanFields) {
  // Serialized snapshots: immune to later mutation, and safe for Vue reactive proxies.
  const stacks = reactive<{ past: string[]; future: string[] }>({ past: [], future: [] });

  const snap = (): string => {
    const s = read();
    return JSON.stringify({
      plannedOrder: s.plannedOrder,
      plannedPages: s.plannedPages,
      plannedDeletions: s.plannedDeletions,
      layout: s.layout,
      linkEdits: s.linkEdits,
      addedLinks: s.addedLinks,
    });
  };

  return {
    /** Record the current state before a mutation. Drops any redo history. */
    checkpoint() {
      stacks.past.push(snap());
      stacks.future = [];
    },
    undo(): PlanFields | null {
      const prev = stacks.past.pop();
      if (prev === undefined) return null;
      stacks.future.push(snap());
      return JSON.parse(prev) as PlanFields;
    },
    redo(): PlanFields | null {
      const next = stacks.future.pop();
      if (next === undefined) return null;
      stacks.past.push(snap());
      return JSON.parse(next) as PlanFields;
    },
    clear() {
      stacks.past = [];
      stacks.future = [];
    },
    get canUndo() {
      return stacks.past.length > 0;
    },
    get canRedo() {
      return stacks.future.length > 0;
    },
  };
}

export type PlanHistory = ReturnType<typeof createHistory>;
