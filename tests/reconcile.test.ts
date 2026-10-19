import { describe, expect, it } from 'vitest';
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
    expect(reconcile(o, prev, clone(prev))).toEqual({ ...o, newKeys: [] });
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
