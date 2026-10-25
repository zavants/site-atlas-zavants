import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyOverlay, migrateOverlay } from '../src/schema/overlay.js';
import { BlockSchema } from '../src/schema/scan.js';
import { SiteStore } from '../src/store/store.js';

const v1 = {
  schemaVersion: 1,
  rev: 3,
  tags: [{ id: 't', name: 'Tag', color: '#fff' }],
  blockTags: { '/#top': ['t'] },
  kindOverrides: { '/#top': 'narrativa' },
  plannedPages: [],
  plannedOrder: {},
  plannedDeletions: [],
  newKeys: [],
  orphans: [],
};

describe('overlay v2', () => {
  it('migrates a v1 overlay with empty new fields', () => {
    const v2 = migrateOverlay(v1);
    expect(v2).toMatchObject({ schemaVersion: 2, rev: 3, layout: {}, components: {}, linkEdits: {}, addedLinks: [], removedLinks: {}, confirmations: {}, authors: {} });
    expect(v2.kindOverrides['/#top']).toBe('narrative');
  });

  it('reads a v2 overlay saved before authors existed', () => {
    const { authors: _authors, ...old } = emptyOverlay();
    expect(migrateOverlay(old).authors).toEqual({});
  });

  it('empty overlay is v2', () => {
    expect(emptyOverlay().schemaVersion).toBe(2);
  });

  it('reads a v1 file from disk as v2 and round-trips a write', async () => {
    const home = await mkdtemp(join(tmpdir(), 'site-atlas-test-'));
    const store = new SiteStore(home);
    await mkdir(store.dir('s'), { recursive: true });
    await writeFile(store.overlayFile('s'), JSON.stringify(v1));
    const read = await store.readOverlay('s');
    expect(read.schemaVersion).toBe(2);
    expect(read.layout).toEqual({});
    const saved = await store.updateOverlay('s', (o) => ({ ...o, layout: { '/#top': { x: 1, y: 2 } } }));
    expect(await store.readOverlay('s')).toEqual(saved);
    expect(saved.layout['/#top']).toEqual({ x: 1, y: 2 });
  });

  it('defaults isComponent on v1 scan blocks', () => {
    const base = {
      key: 'k', name: 'n', heading: null, anchor: null, order: 0, height: 1, kind: 'narrative', fingerprint: 'f',
      textExcerpt: '', components: { headings: [], links: [], buttons: [], forms: [], media: [] }, shot: null,
    };
    expect(BlockSchema.parse({ ...base, tag: 'header', global: false }).isComponent).toBe(true);
    expect(BlockSchema.parse({ ...base, tag: 'section', global: true }).isComponent).toBe(true);
    expect(BlockSchema.parse({ ...base, tag: 'section', global: false }).isComponent).toBe(false);
  });

  it('classifies blocks of a scan saved before roles existed', () => {
    const components = { headings: [], links: [], buttons: [], forms: [], media: [] };
    const base = {
      key: 'k', name: 'n', heading: null, anchor: null, order: 0, height: 1, kind: 'narrative', fingerprint: 'f',
      textExcerpt: '', components, shot: null, global: false, isComponent: false,
    };
    const parse = (over: Record<string, unknown>) => BlockSchema.parse({ ...base, ...over });
    expect(parse({ tag: 'header', isComponent: true }).role).toBe('navigation');
    expect(parse({ tag: 'footer', isComponent: true }).role).toBe('footer');
    expect(parse({ tag: 'section', components: { ...components, headings: [{ level: 1, text: 'Hi' }] } }).role).toBe('hero');
    expect(parse({ tag: 'section', components: { ...components, forms: [{ fields: 2, action: null, method: 'get' }] } })).toMatchObject({
      role: 'form',
      roleReasons: ['form with fields'],
    });
    expect(parse({ tag: 'section', components: { ...components, buttons: ['Ask'] } })).toMatchObject({ role: 'default', cta: true });
    // A scanner that already classified the block is the one truth: its role is never recomputed.
    expect(parse({ tag: 'header', isComponent: true, role: 'default' }).role).toBe('default');
  });
});
