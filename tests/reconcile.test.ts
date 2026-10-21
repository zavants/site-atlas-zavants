import { describe, expect, it } from 'vitest';
import { deriveChanges } from '../src/model/changes.js';
import { assignComponents } from '../src/model/components.js';
import { linkId } from '../src/model/links.js';
import { applyOp } from '../src/model/ops.js';
import { reconcile } from '../src/model/reconcile.js';
import { emptyOverlay, type Overlay } from '../src/schema/overlay.js';
import type { Block, Scan } from '../src/schema/scan.js';
import { sampleScan } from './helpers/sample.js';

const clone = <T>(v: T): T => structuredClone(v);
const tagged = (keys: Record<string, string[]>, extra: Partial<Overlay> = {}): Overlay => ({
  ...emptyOverlay(),
  tags: [{ id: 't', name: 'T', color: '#000' }],
  blockTags: keys,
  ...extra,
});
const page = (scan: Scan, path: string) => scan.pages.find((p) => p.path === path)!;

describe('reconcile', () => {
  it('no cambia nada si el sitio no cambió', () => {
    const prev = sampleScan();
    const o = tagged({ '/#top': ['t'] }, { plannedOrder: { '/': ['/#cotizacion', '/#top', '/~integraciones'] }, newKeys: ['/#top'] });
    expect(reconcile(o, prev, clone(prev))).toEqual({ ...o, newKeys: [], components: assignComponents(o, prev) });
  });

  it('sigue a un bloque con ancla que cambió de página', () => {
    const prev = sampleScan();
    const next = clone(prev);
    const precios = page(next, '/otra').blocks.splice(1, 1)[0]!;
    page(next, '/').blocks.splice(2, 0, { ...precios, key: '/#precios' });
    const o = reconcile(tagged({ '/otra#precios': ['t'] }), prev, next);
    expect(o.blockTags).toEqual({ '/#precios': ['t'] });
    expect(o.orphans).toEqual([]);
  });

  it('sigue a un bloque sin ancla que cambió de título por similitud de texto', () => {
    const prev = sampleScan();
    const next = clone(prev);
    const integ = page(next, '/').blocks[2]!;
    Object.assign(integ, { key: '/~integraciones-nativas', name: 'Integraciones nativas', fingerprint: 'otra-huella' });
    const o = reconcile(tagged({ '/~integraciones': ['t'] }, { kindOverrides: { '/~integraciones': 'visual' } }), prev, next);
    expect(o.blockTags).toEqual({ '/~integraciones-nativas': ['t'] });
    expect(o.kindOverrides).toEqual({ '/~integraciones-nativas': 'visual' });
  });

  it('deja huérfano a un bloque que desapareció y lo quita del orden', () => {
    const prev = sampleScan();
    const next = clone(prev);
    page(next, '/').blocks.splice(2, 1);
    const o = reconcile(tagged({ '/~integraciones': ['t'] }, { plannedOrder: { '/': ['/~integraciones', '/#top', '/#cotizacion'] } }), prev, next);
    expect(o.orphans).toEqual([{ key: '/~integraciones', lastSeen: { page: '/', name: 'Integraciones' }, suggestion: null }]);
    expect(o.plannedOrder['/']).toEqual(['/#top', '/#cotizacion']);
    expect(o.blockTags['/~integraciones']).toEqual(['t']);
  });

  it('no toca las claves de una página que falló al re-escanear', () => {
    const prev = sampleScan();
    const next = clone(prev);
    Object.assign(page(next, '/otra'), { status: 500, error: 'HTTP 500', blocks: [] });
    const before = tagged({ '/otra#precios': ['t'] }, { plannedOrder: { '/otra': ['/otra#precios'] } });
    const o = reconcile(before, prev, next);
    expect(o.orphans).toEqual([]);
    expect(o.blockTags).toEqual(before.blockTags);
    expect(o.plannedOrder).toEqual(before.plannedOrder);
  });

  it('conserva las claves de páginas que no se visitaron en el re-escaneo', () => {
    const prev = sampleScan();
    const next = clone(prev);
    next.pages = next.pages.filter((p) => p.path !== '/otra');
    const before = tagged({ '/otra#precios': ['t'] }, { plannedPages: [{ path: '/nueva', title: 'Nueva' }], plannedOrder: { '/nueva': ['/otra#precios'] } });
    const o = reconcile(before, prev, next);
    expect(o.orphans).toEqual([]);
    expect(o.plannedOrder['/nueva']).toEqual(['/otra#precios']);
  });

  it('deja huérfanas las claves de una página que ya no existe (404)', () => {
    const prev = sampleScan();
    const next = { ...clone(prev), missingPages: ['/otra'] };
    next.pages = next.pages.filter((p) => p.path !== '/otra');
    const o = reconcile(tagged({ '/otra#precios': ['t'] }), prev, next);
    expect(o.orphans.map((x) => x.key)).toEqual(['/otra#precios']);
  });

  it('quita del orden planificado los bloques que pasaron a ser globales', () => {
    const prev = sampleScan();
    const o = reconcile({ ...emptyOverlay(), plannedOrder: { '/': ['/~header', '/#top', '/~integraciones', '/#cotizacion'] } }, prev, clone(prev));
    expect(o.plannedOrder['/']).toEqual(['/#top', '/~integraciones', '/#cotizacion']);
  });

  it('inserta bloques nuevos después de su vecino real y los marca', () => {
    const prev = sampleScan();
    const next = clone(prev);
    const nuevo: Block = { ...page(next, '/').blocks[1]!, key: '/#nuevo', name: 'Nuevo', anchor: 'nuevo', fingerprint: 'fp-nuevo', textExcerpt: 'zzz' };
    page(next, '/').blocks.splice(2, 0, nuevo);
    const o = reconcile({ ...emptyOverlay(), plannedOrder: { '/': ['/#cotizacion', '/#top', '/~integraciones'] } }, prev, next);
    expect(o.plannedOrder['/']).toEqual(['/#cotizacion', '/#top', '/#nuevo', '/~integraciones']);
    expect(o.newKeys).toEqual(['/#nuevo']);
  });

  it('saca de huérfanos a los bloques que vuelven a aparecer', () => {
    const prev = sampleScan();
    const o = reconcile(
      { ...emptyOverlay(), orphans: [{ key: '/#top', lastSeen: { page: '/', name: 'Hero' }, suggestion: null }] },
      prev,
      clone(prev),
    );
    expect(o.orphans).toEqual([]);
  });
});

/** Sample scan rooted at `/` whose hero links to a missing page. */
const linked = (): Scan => {
  const s = sampleScan({ environment: { origin: 'http://localhost:4405', basePath: '/' } });
  page(s, '/').blocks[1]!.components.links = [{ text: 'Ver', href: 'http://localhost:4405/no-existe', kind: 'internal' }];
  return s;
};
const verId = linkId('/#top', 'http://localhost:4405/no-existe', 'Ver');
const toPrecios = { block: '/otra#precios' };

describe('reconcile v2 (links, layout, components)', () => {
  it('names the shared components of the new scan', () => {
    const o = reconcile(emptyOverlay(), null, sampleScan());
    expect(Object.values(o.components).map((c) => c.name).sort()).toEqual(['Footer 1', 'Header 1']);
  });

  it('removes an added link once the site has it, keeping its confirmation', () => {
    const prev = linked();
    const before: Overlay = {
      ...emptyOverlay(),
      addedLinks: [{ id: 'a1', from: '/#top', to: toPrecios, by: 'canvas' }],
      confirmations: { 'addLink:x': { at: '2026-10-20', by: 'agent', note: 'done' } },
    };
    const next = clone(prev);
    page(next, '/').blocks[1]!.components.links.push({ text: 'Precios', href: 'http://localhost:4405/otra#precios', kind: 'internal' });
    const o = reconcile(before, prev, next);
    expect(o.addedLinks).toEqual([]);
    expect(deriveChanges(next, o).filter((c) => c.type === 'addLink')).toEqual([]);
    expect(o.confirmations).toEqual(before.confirmations);
  });

  it('keeps an added link the site does not have yet', () => {
    const prev = linked();
    const added = [{ id: 'a1', from: '/#top', to: toPrecios, by: 'canvas' }];
    const o = reconcile({ ...emptyOverlay(), addedLinks: added }, prev, clone(prev));
    expect(o.addedLinks).toEqual(added);
  });

  it('removes a link edit once observed, whatever the link text', () => {
    const prev = linked();
    const next = clone(prev);
    page(next, '/').blocks[1]!.components.links = [{ text: 'See prices', href: 'http://localhost:4405/otra#precios', kind: 'internal' }];
    const o = reconcile({ ...emptyOverlay(), linkEdits: { [verId]: { ...toPrecios, by: 'canvas' } } }, prev, next);
    expect(o.linkEdits).toEqual({});
    expect(o.orphans).toEqual([]);
    expect(deriveChanges(next, o).filter((c) => c.type === 'relink')).toEqual([]);
  });

  it('keeps a relink while the edited link is still on the site, even if the owner already links to the target', () => {
    const prev = linked();
    page(prev, '/').blocks[1]!.components.links.push({ text: 'Precios', href: 'http://localhost:4405/otra#precios', kind: 'internal' });
    const before = applyOp(emptyOverlay(), prev, { type: 'relink', owner: '/#top', linkText: 'Ver', linkHref: 'http://localhost:4405/no-existe', to: toPrecios });
    const next = clone(prev);
    const o = reconcile(before, prev, next);
    expect(Object.keys(o.linkEdits)).toEqual([verId]);
    expect(deriveChanges(next, o).filter((c) => c.type === 'relink')).toEqual([
      expect.objectContaining({ status: 'pending', observed: false }),
    ]);
  });

  it('drops the links of a discarded block orphan so it does not come back', () => {
    const prev = linked();
    const next = clone(prev);
    page(next, '/otra').blocks.splice(1, 1);
    const before: Overlay = {
      ...emptyOverlay(),
      linkEdits: { [verId]: { ...toPrecios, by: 'canvas' }, [linkId('/otra#precios', '#x', 'X')]: { block: '/#top', by: 'canvas' } },
      addedLinks: [
        { id: 'a1', from: '/#top', to: toPrecios, by: 'canvas' },
        { id: 'a2', from: '/otra#precios', to: { block: '/#top' }, by: 'canvas' },
        { id: 'a3', from: '/#top', to: { block: '/#cotizacion' }, by: 'canvas' },
      ],
    };
    const orphaned = reconcile(before, prev, next);
    expect(orphaned.orphans.map((x) => x.key)).toEqual(['/otra#precios']);
    const discarded = applyOp(orphaned, next, { type: 'resolveOrphan', orphanKey: '/otra#precios', action: 'discard' });
    expect(discarded.linkEdits).toEqual({});
    expect(discarded.addedLinks.map((l) => l.id)).toEqual(['a3']);
    expect(reconcile(discarded, next, clone(next)).orphans).toEqual([]);
  });

  it('turns a relink whose link vanished (not observed) into an orphan', () => {
    const prev = linked();
    const next = clone(prev);
    page(next, '/').blocks[1]!.components.links = [];
    const edits = { [verId]: { ...toPrecios, by: 'canvas' } };
    const o = reconcile({ ...emptyOverlay(), linkEdits: edits }, prev, next);
    expect(o.orphans).toEqual([{ key: verId, lastSeen: { page: '/', name: 'Ver' }, suggestion: null }]);
    expect(o.linkEdits).toEqual(edits);
  });

  it('clears a link orphan when its link comes back', () => {
    const prev = linked();
    const orphans = [{ key: verId, lastSeen: { page: '/', name: 'Ver' }, suggestion: null }];
    const o = reconcile({ ...emptyOverlay(), linkEdits: { [verId]: { ...toPrecios, by: 'canvas' } }, orphans }, prev, clone(prev));
    expect(o.orphans).toEqual([]);
    expect(Object.keys(o.linkEdits)).toEqual([verId]);
  });

  it('does not orphan link edits of a page that failed to re-scan', () => {
    const prev = linked();
    const next = clone(prev);
    Object.assign(page(next, '/'), { status: 500, error: 'HTTP 500', blocks: [] });
    const o = reconcile({ ...emptyOverlay(), linkEdits: { [verId]: { ...toPrecios, by: 'canvas' } } }, prev, next);
    expect(o.orphans).toEqual([]);
  });

  it('orphans a component link edit when the component no longer has that link', () => {
    const prev = linked();
    for (const p of prev.pages) p.blocks[0]!.components.links = [{ text: 'Productos', href: '#productos', kind: 'anchor' }];
    const components = assignComponents(emptyOverlay(), prev);
    const headerId = Object.entries(components).find(([, c]) => c.name === 'Header 1')![0];
    const id = linkId(headerId, '#productos', 'Productos');
    const next = clone(prev);
    for (const p of next.pages) p.blocks[0]!.components.links = [];
    const o = reconcile({ ...emptyOverlay(), components, linkEdits: { [id]: { ...toPrecios, by: 'canvas' } } }, prev, next);
    expect(o.orphans).toEqual([{ key: id, lastSeen: { page: '/', name: 'Productos' }, suggestion: null }]);
  });

  it('renames block keys inside link edits, added links and layout', () => {
    const prev = linked();
    const next = clone(prev);
    const integ = page(next, '/').blocks[2]!;
    Object.assign(integ, { key: '/~integraciones-nativas', name: 'Integraciones nativas', fingerprint: 'otra-huella' });
    integ.components.links = [{ text: 'Ver', href: '#top', kind: 'anchor' }];
    page(prev, '/').blocks[2]!.components.links = [{ text: 'Ver', href: '#top', kind: 'anchor' }];
    const oldId = linkId('/~integraciones', '#top', 'Ver');
    const o = reconcile(
      {
        ...emptyOverlay(),
        linkEdits: { [oldId]: { block: '/otra#precios', by: 'canvas' }, [verId]: { block: '/~integraciones', by: 'canvas' } },
        addedLinks: [{ id: 'a1', from: '/~integraciones', to: { block: '/~integraciones' }, by: 'canvas' }],
        layout: { '/~integraciones': { x: 1, y: 2 }, '/': { x: 0, y: 0 } },
      },
      prev,
      next,
    );
    expect(o.linkEdits).toEqual({
      [linkId('/~integraciones-nativas', '#top', 'Ver')]: { block: '/otra#precios', by: 'canvas' },
      [verId]: { block: '/~integraciones-nativas', by: 'canvas' },
    });
    expect(o.addedLinks).toEqual([{ id: 'a1', from: '/~integraciones-nativas', to: { block: '/~integraciones-nativas' }, by: 'canvas' }]);
    expect(o.layout).toEqual({ '/~integraciones-nativas': { x: 1, y: 2 }, '/': { x: 0, y: 0 } });
    expect(o.orphans).toEqual([]);
  });

  it('orphans a link target section that disappeared', () => {
    const prev = linked();
    const next = clone(prev);
    page(next, '/otra').blocks.splice(1, 1);
    const o = reconcile({ ...emptyOverlay(), linkEdits: { [verId]: { ...toPrecios, by: 'canvas' } } }, prev, next);
    expect(o.orphans.map((x) => x.key)).toEqual(['/otra#precios']);
  });
});
