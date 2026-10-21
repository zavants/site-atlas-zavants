import { describe, expect, it } from 'vitest';
import { applyOp, OpError, type OverlayOp } from '../src/model/ops.js';
import { deriveChanges } from '../src/model/changes.js';
import { assignComponents } from '../src/model/components.js';
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

  it('does not move a block of a shared component, even on one page', () => {
    const s = sampleScan();
    s.pages[0]!.blocks.find((b) => b.key === '/~integraciones')!.isComponent = true;
    const o = { ...emptyOverlay(), components: assignComponents(emptyOverlay(), s) };
    expect(() => applyOp(o, s, { type: 'moveBlock', blockKey: '/~integraciones', toPage: '/otra', index: 0 })).toThrow('"Component 1" is a shared component and cannot be moved.');
    expect(() => applyOp(o, s, { type: 'moveBlock', blockKey: '/~integraciones', toPage: '/', index: 0 })).toThrow(/Component 1/);
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

  it('normalizes a planned page path like the canvas does', () => {
    expect(run({ type: 'addPlannedPage', path: '/Brokers//x/', title: '' }).plannedPages[0]!.path).toBe('/brokers/x');
  });

  it('keeps the case of a missing page so the canvas drop on it can move there', () => {
    const s = sampleScan({ missingPages: ['/About'] });
    s.issues.push({ id: 'broken-link|/|/#top|http://localhost:4405/demo/Team', level: 'error', rule: 'broken-link', page: '/', blockKey: '/#top', message: 'x' });
    for (const path of ['/About', '/Team']) {
      const o = applyOp(applyOp(emptyOverlay(), s, { type: 'addPlannedPage', path, title: path }), s, { type: 'moveBlock', blockKey: '/~integraciones', toPage: path, index: 0 });
      expect(o.plannedPages[0]!.path).toBe(path);
      expect(o.plannedOrder[path]).toEqual(['/~integraciones']);
    }
  });

  it('removes a planned page by the path it was added with or the stored one', () => {
    const added = run({ type: 'addPlannedPage', path: '/Brokers', title: 'Brokers' });
    expect(applyOp(added, scan, { type: 'removePlannedPage', path: '/Brokers' }).plannedPages).toEqual([]);
    const legacy: Overlay = { ...emptyOverlay(), plannedPages: [{ path: '/Old', title: 'Old' }] };
    expect(applyOp(legacy, scan, { type: 'removePlannedPage', path: '/Old' }).plannedPages).toEqual([]);
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

  it('rechaza etiquetas y claves inexistentes con English message', () => {
    expect(() => run({ type: 'setBlockTags', blockKey: '/#top', tagIds: ['nope'] })).toThrow(/tag/i);
    expect(() => run({ type: 'markDeleted', blockKey: '/#nada' })).toThrow(/No section/);
  });

  it('renames a shared component, trimmed, and rejects an empty name or an unknown id', () => {
    const o = { ...emptyOverlay(), components: assignComponents(emptyOverlay(), scan) };
    const renamed = applyOp(o, scan, { type: 'renameComponent', componentId: 'c:fp-header', name: '  Main header ' });
    expect(renamed.components['c:fp-header']).toMatchObject({ name: 'Main header', fingerprint: 'fp-header' });
    expect(() => applyOp(o, scan, { type: 'renameComponent', componentId: 'c:fp-header', name: '  ' })).toThrow('A component needs a name.');
    expect(() => applyOp(o, scan, { type: 'renameComponent', componentId: 'c:nope', name: 'X' })).toThrow('Component c:nope does not exist.');
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
    expect(view(o).pages[0]!.blocks.find((b) => b.key === '/~integraciones')).toMatchObject({ effectiveKind: 'narrative', kindOverridden: false });
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

  it('relinking back to the original target drops the edit', () => {
    const s = sampleScan();
    s.pages[0]!.blocks[1]!.components.links = [{ text: 'Quote', href: '#cotizacion', kind: 'anchor' }];
    const relink = (to: { block: string }): OverlayOp => ({ type: 'relink', owner: '/#top', linkText: 'Quote', linkHref: '#cotizacion', to });
    const edited = applyOp(emptyOverlay(), s, relink({ block: '/otra#precios' }));
    expect(Object.keys(edited.linkEdits)).toHaveLength(1);
    const back = applyOp(edited, s, relink({ block: '/#cotizacion' }));
    expect(back.linkEdits).toEqual({});
    expect(deriveChanges(s, back).filter((c) => c.type === 'relink')).toEqual([]);
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
