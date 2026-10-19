import { describe, expect, it } from 'vitest';
import { applyOp, OpError, type OverlayOp } from '../src/model/ops.js';
import { buildMap } from '../src/model/map.js';
import { emptyOverlay, type Overlay } from '../src/schema/overlay.js';
import { sampleScan } from './helpers/sample.js';

const scan = sampleScan();
const run = (...ops: OverlayOp[]): Overlay => ops.reduce((o, op) => applyOp(o, scan, op), emptyOverlay());
const view = (o: Overlay) => buildMap(scan, o);
const keysOf = (o: Overlay, path: string) => view(o).pages.find((p) => p.path === path)!.blocks.map((b) => b.key);

describe('applyOp + buildMap', () => {
  it('mueve un bloque a otra página y lo marca como movido', () => {
    const o = run({ type: 'moveBlock', blockKey: '/~integraciones', toPage: '/otra', index: 0 });
    expect(o.plannedOrder['/']).not.toContain('/~integraciones');
    expect(o.plannedOrder['/otra']![0]).toBe('/~integraciones');
    const moved = view(o).pages[1]!.blocks[0]!;
    expect(moved).toMatchObject({ key: '/~integraciones', moved: true, page: '/' });
  });

  it('reordenar una página no crea orden en las demás', () => {
    const o = run({ type: 'moveBlock', blockKey: '/#cotizacion', toPage: '/', index: 0 });
    expect(Object.keys(o.plannedOrder)).toEqual(['/']);
    expect(keysOf(o, '/')).toEqual(['/#cotizacion', '/#top', '/~integraciones']);
    expect(keysOf(o, '/otra')).toEqual(['/otra#precios']);
  });

  it('al reordenar solo marca como movido al bloque desplazado', () => {
    const o = run({ type: 'moveBlock', blockKey: '/#cotizacion', toPage: '/', index: 0 });
    const moved = view(o).pages[0]!.blocks.filter((b) => b.moved).map((b) => b.key);
    expect(moved).toEqual(['/#cotizacion']);
  });

  it('no mueve bloques globales a otra página', () => {
    expect(() => run({ type: 'moveBlock', blockKey: '/~header', toPage: '/otra', index: 0 })).toThrow(OpError);
  });

  it('crea páginas planificadas al final', () => {
    const o = run(
      { type: 'addPlannedPage', path: '/soluciones', title: 'Soluciones' },
      { type: 'moveBlock', blockKey: '/#top', toPage: '/soluciones', index: 5 },
    );
    const pages = view(o).pages;
    expect(pages.at(-1)).toMatchObject({ path: '/soluciones', planned: true });
    expect(pages.at(-1)!.blocks.map((b) => b.key)).toEqual(['/#top']);
    expect(() => applyOp(o, scan, { type: 'addPlannedPage', path: '/soluciones', title: 'x' })).toThrow(OpError);
  });

  it('borrar una etiqueta la quita de los bloques', () => {
    let o = run({ type: 'createTag', name: 'Confianza' });
    const tagId = o.tags[0]!.id;
    expect(o.tags[0]!.color).toMatch(/^#/);
    o = applyOp(o, scan, { type: 'setBlockTags', blockKey: '/#top', tagIds: [tagId] });
    expect(view(o).pages[0]!.blocks.find((b) => b.key === '/#top')!.tags).toEqual([tagId]);
    o = applyOp(o, scan, { type: 'deleteTag', tagId });
    expect(o.tags).toEqual([]);
    expect(o.blockTags['/#top'] ?? []).toEqual([]);
  });

  it('rechaza etiquetas y claves inexistentes con mensaje en español', () => {
    expect(() => run({ type: 'setBlockTags', blockKey: '/#top', tagIds: ['nope'] })).toThrow(/etiqueta/i);
    expect(() => run({ type: 'markDeleted', blockKey: '/#nada' })).toThrow(/bloque/i);
  });

  it('marca y restaura eliminaciones', () => {
    let o = run({ type: 'markDeleted', blockKey: '/#top' });
    expect(view(o).pages[0]!.blocks.find((b) => b.key === '/#top')!.deleted).toBe(true);
    o = applyOp(o, scan, { type: 'restore', blockKey: '/#top' });
    expect(view(o).pages[0]!.blocks.find((b) => b.key === '/#top')!.deleted).toBe(false);
  });

  it('corrige y revierte el tipo', () => {
    let o = run({ type: 'setKind', blockKey: '/~integraciones', kind: 'visual' });
    expect(view(o).pages[0]!.blocks.find((b) => b.key === '/~integraciones')).toMatchObject({ effectiveKind: 'visual', kindOverridden: true });
    o = applyOp(o, scan, { type: 'setKind', blockKey: '/~integraciones', kind: null });
    expect(view(o).pages[0]!.blocks.find((b) => b.key === '/~integraciones')).toMatchObject({ effectiveKind: 'narrativa', kindOverridden: false });
  });

  it('ignora claves globales que quedaron en el orden planificado', () => {
    const o: Overlay = { ...emptyOverlay(), plannedOrder: { '/': ['/~header', '/#cotizacion', '/#top', '/~integraciones', '/~footer'] } };
    expect(keysOf(o, '/')).toEqual(['/#cotizacion', '/#top', '/~integraciones']);
  });

  it('separa globales y cuenta alertas', () => {
    const m = view(emptyOverlay());
    expect(m.globals.map((b) => b.name)).toEqual(['Header', 'Footer']);
    expect(m.pages[0]!.realOrder).toEqual(['/#top', '/~integraciones', '/#cotizacion']);
    expect(m.issueCount).toEqual({ error: 1, warn: 1, info: 1 });
    expect(m.pages[0]!.blocks[0]!.issues.map((i) => i.rule)).toEqual(['broken-link']);
  });

  it('asigna un huérfano a otro bloque', () => {
    const base: Overlay = {
      ...emptyOverlay(),
      tags: [{ id: 't', name: 'T', color: '#000' }],
      blockTags: { '/~viejo': ['t'] },
      orphans: [{ key: '/~viejo', lastSeen: { page: '/', name: 'Viejo' }, suggestion: '/~integraciones' }],
    };
    const o = applyOp(base, scan, { type: 'resolveOrphan', orphanKey: '/~viejo', action: 'assign', targetKey: '/~integraciones' });
    expect(o.orphans).toEqual([]);
    expect(o.blockTags['/~integraciones']).toEqual(['t']);
    expect(o.blockTags['/~viejo']).toBeUndefined();
  });
});
