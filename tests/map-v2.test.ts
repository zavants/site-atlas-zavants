import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectiveLinks, linkId } from '../src/model/links.js';
import { buildMap } from '../src/model/map.js';
import { applyOp } from '../src/model/ops.js';
import { reconcile } from '../src/model/reconcile.js';
import { getMap, getPlan, mutate } from '../src/model/service.js';
import { emptyOverlay } from '../src/schema/overlay.js';
import type { Scan } from '../src/schema/scan.js';
import { SiteStore } from '../src/store/store.js';
import { sampleScan } from './helpers/sample.js';

/** Sample scan rooted at `/`: the hero has a broken link, a link to /otra#precios and an external one. */
const fixture = (): Scan => {
  const s = sampleScan({ environment: { origin: 'http://localhost:4405', basePath: '/' } });
  s.pages[0]!.blocks[1]!.components.links = [
    { text: 'Ver', href: 'http://localhost:4405/no-existe', kind: 'internal' },
    { text: 'Precios', href: 'http://localhost:4405/otra#precios', kind: 'internal' },
    { text: 'Docs', href: 'https://docs.example.com/guide', kind: 'external' },
  ];
  s.issues[0] = { ...s.issues[0]!, id: 'broken-link|/|/#top|http://localhost:4405/no-existe' };
  return s;
};

describe('buildMap v2', () => {
  const scan = fixture();
  const overlay = reconcile(emptyOverlay(), null, scan);
  const map = buildMap(scan, overlay);
  const hero = map.pages.find((p) => p.path === '/')!.blocks.find((b) => b.key === '/#top')!;

  it('lists shared components with the pages that use them', () => {
    const header = map.components.find((c) => c.name === 'Header 1')!;
    expect(header.usedOn).toEqual(['/', '/otra']);
    expect(header.block.key).toBe('/~header');
    expect(header.block.componentId).toBe(header.id);
    expect(map.components.map((c) => c.name).sort()).toEqual(['Footer 1', 'Header 1']);
  });

  it('marks each piece with its component id', () => {
    const header = map.globals.find((b) => b.tag === 'header')!;
    expect(header.componentId).toBe(map.components.find((c) => c.name === 'Header 1')!.id);
    expect(hero.componentId).toBeNull();
  });

  it('adds a target per missing page, broken link target and external origin', () => {
    expect(map.targets).toContainEqual({ kind: 'missing', id: '/no-existe', label: '/no-existe' });
    expect(map.targets).toContainEqual({ kind: 'external', id: 'https://docs.example.com', label: 'docs.example.com' });
    const withMissing = buildMap({ ...scan, missingPages: ['/vieja'] }, overlay);
    expect(withMissing.targets).toContainEqual({ kind: 'missing', id: '/vieja', label: '/vieja' });
    expect(new Set(map.targets.map((t) => t.id)).size).toBe(map.targets.length);
  });

  it('lists the effective links of every piece', () => {
    const block = scan.pages[0]!.blocks[1]!;
    expect(hero.links).toEqual(effectiveLinks(block, scan, overlay));
    expect(hero.links.map((l) => l.target)).toEqual([{ page: '/no-existe' }, { block: '/otra#precios' }, { page: 'https://docs.example.com' }]);
  });

  it('shows link edits and the layout', () => {
    let o = applyOp(overlay, scan, { type: 'relink', owner: '/#top', linkText: 'Ver', linkHref: 'http://localhost:4405/no-existe', to: { block: '/otra#precios' } });
    o = applyOp(o, scan, { type: 'setLayout', id: '/otra', x: 10, y: 20 });
    const m = buildMap(scan, o);
    const link = m.pages[0]!.blocks.find((b) => b.key === '/#top')!.links.find((l) => l.id === linkId('/#top', 'http://localhost:4405/no-existe', 'Ver'))!;
    expect(link).toMatchObject({ edited: true, target: { block: '/otra#precios' } });
    expect(m.layout).toEqual({ '/otra': { x: 10, y: 20 } });
  });

  it('exposes exactly the seven plan fields the canvas history snapshots', () => {
    let o = applyOp(overlay, scan, { type: 'addPlannedPage', path: '/nueva', title: 'Nueva' });
    o = applyOp(o, scan, { type: 'addLink', owner: '/#top', to: { page: '/nueva' } });
    o = applyOp(o, scan, { type: 'createTag', name: 'x' });
    const m = buildMap(scan, o);
    expect(m.planFields).toEqual({
      plannedOrder: o.plannedOrder,
      plannedPages: o.plannedPages,
      plannedDeletions: o.plannedDeletions,
      layout: o.layout,
      linkEdits: o.linkEdits,
      addedLinks: o.addedLinks,
      removedLinks: o.removedLinks,
    });
  });
});

describe('service with a v1 overlay (no components yet)', () => {
  it('names components lazily so a header relink from the map works and persists them', async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    const scan = fixture();
    for (const p of scan.pages) p.blocks[0]!.components.links = [{ text: 'Productos', href: '#productos', kind: 'anchor' }];
    await store.saveScan(scan);
    const v1 = { schemaVersion: 1, rev: 0, tags: [], blockTags: {}, kindOverrides: {}, plannedPages: [], plannedOrder: {}, plannedDeletions: [], newKeys: [], orphans: [] };
    await writeFile(store.overlayFile(scan.site), JSON.stringify(v1));

    const map = await getMap(store, scan.site);
    const header = map.globals.find((b) => b.tag === 'header')!;
    expect(header.componentId).toBe('c:fp-header');
    const owner = header.links[0]!.owner;
    expect(owner).toBe('c:fp-header');

    const after = await mutate(store, scan.site, { type: 'relink', owner, linkText: 'Productos', linkHref: '#productos', to: { block: '/#top' } });
    expect(after.globals.find((b) => b.tag === 'header')!.links[0]).toMatchObject({ edited: true, target: { block: '/#top' } });
    expect(Object.keys((await store.readOverlay(scan.site)).components).sort()).toEqual(['c:fp-footer', 'c:fp-header']);
    const plan = await getPlan(store, scan.site);
    expect(plan.changes.filter((c) => c.type === 'relink')).toHaveLength(1);
  });
});
