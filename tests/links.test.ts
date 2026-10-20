import { describe, expect, it } from 'vitest';
import { assignComponents } from '../src/model/components.js';
import { effectiveLinks, linkId, owner, resolveTarget } from '../src/model/links.js';
import { applyOp, OpError, OverlayOpSchema, type OverlayOp } from '../src/model/ops.js';
import { emptyOverlay, type Overlay } from '../src/schema/overlay.js';
import type { Scan } from '../src/schema/scan.js';
import { sampleScan } from './helpers/sample.js';

const withLinks = (): Scan => {
  const scan = sampleScan({ environment: { origin: 'http://h', basePath: '/demo/' } });
  for (const page of scan.pages) {
    const header = page.blocks[0]!;
    header.components.links = [
      { text: ' Productos ', href: '#productos', kind: 'anchor' },
      { text: 'SCAP', href: 'https://scapbroker.com/', kind: 'external' },
    ];
  }
  return scan;
};
const scan = withLinks();
const base = (): Overlay => ({ ...emptyOverlay(), components: assignComponents(emptyOverlay(), scan) });
const run = (o: Overlay, ...ops: OverlayOp[]): Overlay => ops.reduce((acc, op) => applyOp(acc, scan, op), o);

describe('resolveTarget', () => {
  it.each(['/otra', '/otra/', '/otra?x=1', 'http://h/demo/otra', 'otra/index.html'])('%s -> page /otra', (href) => {
    expect(resolveTarget(href, scan, '/')).toEqual({ page: '/otra' });
  });

  it('resolves anchors and url fragments to sections', () => {
    expect(resolveTarget('#cotizacion', scan, '/')).toEqual({ block: '/#cotizacion' });
    expect(resolveTarget('/otra#precios', scan, '/')).toEqual({ block: '/otra#precios' });
    expect(resolveTarget('/otra#nada', scan, '/')).toEqual({ page: '/otra' });
    expect(resolveTarget('#nada', scan, '/')).toBeNull();
  });

  it('resolves external urls to their origin', () => {
    expect(resolveTarget('https://scapbroker.com/', scan, '/')).toEqual({ page: 'https://scapbroker.com' });
    expect(resolveTarget('mailto:a@b.c', scan, '/')).toBeNull();
  });
});

describe('link ops', () => {
  const header = (path: string) => scan.pages.find((p) => p.path === path)!.blocks[0]!;

  it('relink on a component applies on every page', () => {
    const o0 = base();
    const id = owner(header('/'), o0);
    expect(id).toMatch(/^c:/);
    const o = run(o0, { type: 'relink', owner: id, linkText: 'Productos', linkHref: '#productos', to: { block: '/#cotizacion' } });
    expect(Object.keys(o.linkEdits)).toEqual([linkId(id, '#productos', 'Productos')]);
    expect(o.linkEdits[linkId(id, '#productos', 'Productos')]).toEqual({ block: '/#cotizacion', by: 'canvas' });
    for (const path of ['/', '/otra']) {
      const link = effectiveLinks(header(path), scan, o).find((l) => l.href === '#productos')!;
      expect(link).toMatchObject({ target: { block: '/#cotizacion' }, edited: true, added: false });
    }
  });

  it('relink to a missing section throws', () => {
    const o = base();
    expect(() => run(o, { type: 'relink', owner: owner(header('/'), o), linkText: 'a', linkHref: '#a', to: { block: '/#x' } })).toThrow(
      new OpError('No section /#x in the latest scan.'),
    );
  });

  it('relink rejects a link the owner does not have, matching the text trimmed and the href exactly', () => {
    const o0 = base();
    const id = owner(header('/'), o0);
    const to = { page: '/otra' };
    expect(() => run(o0, { type: 'relink', owner: id, linkText: 'Nope', linkHref: '#productos', to })).toThrow(new OpError(`No link "Nope" → #productos in ${id}.`));
    expect(() => run(o0, { type: 'relink', owner: id, linkText: 'Productos', linkHref: '#otro', to })).toThrow(
      new OpError(`No link "Productos" → #otro in ${id}.`),
    );
    expect(() => run(o0, { type: 'relink', owner: '/#top', linkText: 'Productos', linkHref: '#productos', to })).toThrow(OpError);
    expect(Object.keys(run(o0, { type: 'relink', owner: id, linkText: '  Productos', linkHref: '#productos', to }).linkEdits)).toEqual([
      linkId(id, '#productos', 'Productos'),
    ]);
  });

  it('rejects unknown pages and accepts seen external origins', () => {
    const o = base();
    const id = owner(header('/'), o);
    expect(() => run(o, { type: 'addLink', owner: id, to: { page: '/nope' } })).toThrow(OpError);
    expect(run(o, { type: 'addLink', owner: id, to: { page: 'https://scapbroker.com' } }).addedLinks).toHaveLength(1);
  });

  it('addLink then removeLink round-trips', () => {
    const o0 = base();
    const id = owner(header('/'), o0);
    const added = run(o0, { type: 'addLink', owner: id, to: { page: '/otra' }, label: 'Otra', by: 'agent' });
    expect(added.addedLinks[0]).toMatchObject({ from: id, to: { page: '/otra' }, label: 'Otra', by: 'agent' });
    expect(effectiveLinks(header('/'), scan, added)[0]).toMatchObject({ added: true, text: 'Otra', target: { page: '/otra' } });
    expect(run(added, { type: 'removeLink', linkId: added.addedLinks[0]!.id })).toEqual(o0);
  });

  it('removePlannedPage returns pieces and drops links to it', () => {
    const o0 = base();
    const id = owner(header('/'), o0);
    const o = run(
      o0,
      { type: 'addPlannedPage', path: '/soluciones', title: 'Soluciones' },
      { type: 'moveBlock', blockKey: '/#top', toPage: '/soluciones', index: 0 },
      { type: 'addLink', owner: id, to: { page: '/soluciones' } },
      { type: 'relink', owner: id, linkText: 'SCAP', linkHref: 'https://scapbroker.com/', to: { page: '/soluciones' } },
      { type: 'setLayout', id: '/soluciones', x: 1, y: 2 },
    );
    const gone = run(o, { type: 'removePlannedPage', path: '/soluciones' });
    expect(gone.plannedPages).toEqual([]);
    expect(gone.addedLinks).toEqual([]);
    expect(gone.linkEdits).toEqual({});
    expect(gone.layout).toEqual({});
    expect(gone.plannedOrder['/soluciones']).toBeUndefined();
    expect(() => run(gone, { type: 'removePlannedPage', path: '/soluciones' })).toThrow(OpError);
  });

  it('setLayout stores a position', () => {
    expect(run(base(), { type: 'setLayout', id: '/', x: 10, y: 20 }).layout).toEqual({ '/': { x: 10, y: 20 } });
  });

  it('replacePlanFields replaces exactly the six fields', () => {
    const o0 = { ...base(), tags: [{ id: 't', name: 'T', color: '#000' }], confirmations: { k: { at: 'a', by: 'b', note: 'n' } } };
    const fields = { plannedOrder: { '/': ['/#top'] }, plannedPages: [], plannedDeletions: ['/#top'], layout: { '/': { x: 1, y: 1 } }, linkEdits: {}, addedLinks: [] };
    const o = run(o0, { type: 'replacePlanFields', fields });
    expect(o).toEqual({ ...o0, ...fields });
  });

  it('the schema accepts the new ops and defaults by', () => {
    const parsed = OverlayOpSchema.parse({ type: 'setLayout', id: 'a', x: 1, y: 2 }) as { by: string };
    expect(parsed.by).toBe('canvas');
    expect(OverlayOpSchema.safeParse({ type: 'relink', owner: 'o', linkText: 't', linkHref: 'h', to: { page: '/' } }).success).toBe(true);
    expect(OverlayOpSchema.safeParse({ type: 'replacePlanFields', fields: emptyOverlay() }).success).toBe(true);
    expect(OverlayOpSchema.safeParse({ type: 'removeLink', linkId: 'x' }).success).toBe(true);
    expect(OverlayOpSchema.safeParse({ type: 'addLink', owner: 'o', to: { block: 'b' } }).success).toBe(true);
    expect(OverlayOpSchema.safeParse({ type: 'removePlannedPage', path: '/p' }).success).toBe(true);
  });
});
