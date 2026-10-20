import { describe, expect, it } from 'vitest';
import { createHistory, type PlanFields } from '../canvas/src/org/history.js';

const fresh = (): PlanFields => ({
  plannedOrder: { '/': ['a', 'b'] },
  plannedPages: [],
  plannedDeletions: [],
  layout: {},
  linkEdits: {},
  addedLinks: [],
});

describe('history', () => {
  it('starts empty', () => {
    const h = createHistory(fresh);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it('undo returns the earlier snapshot and redo the later one', () => {
    const state = fresh();
    const h = createHistory(() => state);
    h.checkpoint();
    state.plannedOrder['/'] = ['b', 'a'];
    state.plannedPages.push({ path: '/x', title: 'X' });

    const back = h.undo();
    expect(back?.plannedOrder['/']).toEqual(['a', 'b']);
    expect(back?.plannedPages).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    const fwd = h.redo();
    expect(fwd?.plannedOrder['/']).toEqual(['b', 'a']);
    expect(fwd?.plannedPages).toEqual([{ path: '/x', title: 'X' }]);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('snapshots are deep copies', () => {
    const state = fresh();
    const h = createHistory(() => state);
    h.checkpoint();
    state.plannedOrder['/']!.push('c');
    expect(h.undo()?.plannedOrder['/']).toEqual(['a', 'b']);
  });

  it('a new checkpoint after undo clears redo', () => {
    const state = fresh();
    const h = createHistory(() => state);
    h.checkpoint();
    state.layout['/a'] = { x: 1, y: 2 };
    h.undo();
    expect(h.canRedo).toBe(true);
    h.checkpoint();
    expect(h.canRedo).toBe(false);
  });

  it('keeps only the six plan fields', () => {
    const state = { ...fresh(), rev: 9, tags: [{ id: 't' }] } as unknown as PlanFields;
    const h = createHistory(() => state);
    h.checkpoint();
    const snap = h.undo() as unknown as Record<string, unknown>;
    expect(Object.keys(snap).sort()).toEqual([
      'addedLinks',
      'layout',
      'linkEdits',
      'plannedDeletions',
      'plannedOrder',
      'plannedPages',
    ]);
  });

  it('clear drops both stacks', () => {
    const h = createHistory(fresh);
    h.checkpoint();
    h.undo();
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
