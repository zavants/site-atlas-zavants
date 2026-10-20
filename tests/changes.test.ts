import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { changeId, deriveChanges, observedLink, type Change } from '../src/model/changes.js';
import { assignComponents } from '../src/model/components.js';
import { owner } from '../src/model/links.js';
import { applyOp, OpError, type OverlayOp } from '../src/model/ops.js';
import { reconcile } from '../src/model/reconcile.js';
import { emptyOverlay, type Overlay } from '../src/schema/overlay.js';
import type { Scan } from '../src/schema/scan.js';
import { sampleScan } from './helpers/sample.js';

const scan = sampleScan();
const run = (o: Overlay, s: Scan, ...ops: OverlayOp[]): Overlay => ops.reduce((acc, op) => applyOp(acc, s, op), o);
const after = (...ops: OverlayOp[]) => run(emptyOverlay(), scan, ...ops);
const confirm = (id: string, note = 'Moved the section in src/pages/otra.astro'): OverlayOp => ({ type: 'confirmChange', changeId: id, note, by: 'test-agent' });
const only = (changes: Change[], type: Change['type']) => changes.filter((c) => c.type === type);
const moveIntegraciones: OverlayOp = { type: 'moveBlock', blockKey: '/~integraciones', toPage: '/otra', index: 0 };

/** Sample scan with links, rooted at `/` so hrefs are site paths. */
const linkedScan = (basePath = '/'): Scan => {
  const s = sampleScan({ environment: { origin: 'http://localhost:4405', basePath } });
  const hero = s.pages[0]!.blocks[1]!;
  hero.components.links = [
    { text: 'Ver', href: 'http://localhost:4405/no-existe', kind: 'internal' },
    { text: 'Precios', href: `http://localhost:4405${basePath}otra#precios`, kind: 'internal' },
  ];
  for (const page of s.pages) page.blocks[0]!.components.links = [{ text: 'Productos', href: '#productos', kind: 'anchor' }];
  return s;
};
const withComponents = (s: Scan): Overlay => ({ ...emptyOverlay(), components: assignComponents(emptyOverlay(), s) });

describe('authors', () => {
  const byOf = (o: Overlay, type: Change['type']) => only(deriveChanges(scan, o), type).map((c) => c.by);

  it('records who proposed moves, reorders, deletions and pages, and defaults to canvas', () => {
    const o = after(
      { type: 'addPlannedPage', path: '/nueva', title: 'Nueva', by: 'claude-code' },
      { type: 'moveBlock', blockKey: '/~integraciones', toPage: '/otra', index: 0, by: 'claude-code' },
      { type: 'moveBlock', blockKey: '/#cotizacion', toPage: '/', index: 0, by: 'cursor' },
      { type: 'markDeleted', blockKey: '/otra#precios', by: 'cli' },
    );
    expect(byOf(o, 'newPage')).toEqual(['claude-code']);
    expect(byOf(o, 'move')).toEqual(['claude-code']);
    expect(byOf(o, 'reorder')).toEqual(['cursor']);
    expect(byOf(o, 'delete')).toEqual(['cli']);
    expect(o.authors).toEqual({
      'newPage|/nueva': 'claude-code',
      'move|/~integraciones': 'claude-code',
      'reorder|/': 'cursor',
      'delete|/otra#precios': 'cli',
    });
  });

  it('an op without by (the canvas) is attributed to canvas', () => {
    const o = after(moveIntegraciones, { type: 'markDeleted', blockKey: '/otra#precios' }, { type: 'addPlannedPage', path: '/nueva', title: 'Nueva' });
    expect([...byOf(o, 'move'), ...byOf(o, 'delete'), ...byOf(o, 'newPage')]).toEqual(['canvas', 'canvas', 'canvas']);
  });

  it('restore and removePlannedPage drop the author; a later proposal by someone else takes over', () => {
    const o = after({ type: 'markDeleted', blockKey: '/otra#precios', by: 'cli' }, { type: 'addPlannedPage', path: '/nueva', title: 'Nueva', by: 'cli' });
    const cleared = run(o, scan, { type: 'restore', blockKey: '/otra#precios' }, { type: 'removePlannedPage', path: '/nueva' });
    expect(cleared.authors).toEqual({});
    expect(byOf(run(o, scan, { type: 'markDeleted', blockKey: '/otra#precios', by: 'cursor' }), 'delete')).toEqual(['cursor']);
  });
});

describe('changeId', () => {
  it('is the type plus a short sha1 of the parts', () => {
    const sha = createHash('sha1').update('/~integraciones\n/otra').digest('hex').slice(0, 10);
    expect(changeId('move', ['/~integraciones', '/otra'])).toBe(`move:${sha}`);
  });
});

describe('deriveChanges', () => {
  it('describes a move as one pending change whose id ignores the position', () => {
    const changes = deriveChanges(scan, after(moveIntegraciones));
    expect(changes).toHaveLength(1);
    const move = changes[0]!;
    expect(move).toMatchObject({ type: 'move', status: 'pending', summary: 'Move "Integraciones" from / to /otra', by: 'canvas' });
    expect(move.id).toBe(changeId('move', ['/~integraciones', '/otra']));
    expect(move.doneWhen).toContain('/otra');
    expect(move.doneWhen).toContain(' / ');
    expect(move.details).toMatchObject({ fromPage: '/', toPage: '/otra', position: 1, section: { blockKey: '/~integraciones', name: 'Integraciones' } });
    expect(move.observed).toBe(false);

    const shifted = deriveChanges(scan, after(moveIntegraciones, { type: 'moveBlock', blockKey: '/otra#precios', toPage: '/otra', index: 0 }));
    expect(only(shifted, 'move').map((c) => c.id)).toEqual([move.id]);
    expect(only(shifted, 'move')[0]!.details).toMatchObject({ position: 2, previousSection: { blockKey: '/otra#precios' }, nextSection: null });
  });

  it('reports one reorder change per displaced section', () => {
    const changes = deriveChanges(scan, after({ type: 'moveBlock', blockKey: '/#cotizacion', toPage: '/', index: 0 }));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: 'reorder',
      id: changeId('reorder', ['/#cotizacion', '/', 'start']),
      details: { page: '/', position: 1, previousSection: null, nextSection: { blockKey: '/#top' } },
      observed: false,
    });
  });

  it('lists changes in the order newPage, move, delete, reorder, relink, addLink', () => {
    const s = linkedScan();
    const o = run(
      withComponents(s),
      s,
      { type: 'addLink', owner: '/#top', to: { page: '/otra' }, by: 'agent' },
      { type: 'relink', owner: '/#top', linkText: 'Ver', linkHref: 'http://localhost:4405/no-existe', to: { page: '/otra' } },
      { type: 'moveBlock', blockKey: '/#cotizacion', toPage: '/', index: 0 },
      { type: 'markDeleted', blockKey: '/otra#precios' },
      { type: 'addPlannedPage', path: '/soluciones', title: 'Soluciones' },
      { type: 'moveBlock', blockKey: '/~integraciones', toPage: '/soluciones', index: 0 },
    );
    const changes = deriveChanges(s, o);
    expect(changes.map((c) => c.type)).toEqual(['newPage', 'move', 'delete', 'reorder', 'relink', 'addLink']);
    expect(changes.at(-1)!.by).toBe('agent');
    expect(new Set(changes.map((c) => c.id)).size).toBe(changes.length);
  });

  it('relink suggests an anchor href and is not observed while the edited link is still there', () => {
    const s = linkedScan();
    const o0 = withComponents(s);
    const o = run(o0, s, { type: 'relink', owner: '/#top', linkText: 'Ver', linkHref: 'http://localhost:4405/no-existe', to: { block: '/#cotizacion' }, by: 'agent' });
    const [relink] = deriveChanges(s, o);
    expect(relink).toMatchObject({ type: 'relink', status: 'pending', by: 'agent', observed: false });
    expect(relink!.id).toBe(changeId('relink', ['/#top|http://localhost:4405/no-existe|Ver', '/#cotizacion']));
    expect(relink!.details).toMatchObject({ linkText: 'Ver', currentHref: 'http://localhost:4405/no-existe', suggestedHref: '/#cotizacion' });

    const toPrecios = run(o0, s, { type: 'relink', owner: '/#top', linkText: 'Ver', linkHref: 'http://localhost:4405/no-existe', to: { block: '/otra#precios' } });
    // The owner already links to /otra#precios ("Precios"), but "Ver" itself is unchanged: not observed (§10b ruling).
    expect(deriveChanges(s, toPrecios)[0]).toMatchObject({ observed: false, details: { suggestedHref: '/otra#precios' } });

    const demo = linkedScan('/demo/');
    const onDemo = run(withComponents(demo), demo, { type: 'relink', owner: '/#top', linkText: 'Ver', linkHref: 'http://localhost:4405/no-existe', to: { block: '/otra#precios' } });
    expect(deriveChanges(demo, onDemo)[0]!.details.suggestedHref).toBe('/demo/otra#precios');
  });

  it('relink id follows the target section, not its position', () => {
    const s = linkedScan();
    const relink: OverlayOp = { type: 'relink', owner: '/#top', linkText: 'Ver', linkHref: 'http://localhost:4405/no-existe', to: { block: '/otra#precios' } };
    const before = deriveChanges(s, run(withComponents(s), s, relink));
    const moved = deriveChanges(s, run(withComponents(s), s, relink, { type: 'moveBlock', blockKey: '/otra#precios', toPage: '/', index: 0 }));
    expect(only(moved, 'relink')[0]!.id).toBe(before[0]!.id);
    expect(only(moved, 'relink')[0]!.details.suggestedHref).toBe('/#precios');
  });

  it('a component link change names every page that uses it', () => {
    const s = linkedScan();
    const o0 = withComponents(s);
    const header = owner(s.pages[0]!.blocks[0]!, o0);
    const changes = deriveChanges(s, run(o0, s, { type: 'relink', owner: header, linkText: 'Productos', linkHref: '#productos', to: { block: '/#top' } }));
    expect(changes).toHaveLength(1);
    expect(changes[0]!.summary).toContain('Header 1 (used on: /, /otra)');
  });

  it('addLink is observed when the scan already links the owner to the target', () => {
    const s = linkedScan();
    const o0 = withComponents(s);
    const seen = deriveChanges(s, run(o0, s, { type: 'addLink', owner: '/#top', to: { block: '/otra#precios' } }));
    expect(seen[0]).toMatchObject({ type: 'addLink', observed: true, id: changeId('addLink', ['/#top', '/otra#precios']) });
    const unseen = deriveChanges(s, run(o0, s, { type: 'addLink', owner: '/#top', to: { block: '/#cotizacion' } }));
    expect(unseen[0]).toMatchObject({ observed: false, details: { suggestedHref: '/#cotizacion' } });
  });

  it('newPage lists the broken links it resolves', () => {
    const s = linkedScan();
    s.issues.push({ id: 'broken-link|/|/#top|http://localhost:4405/no-existe', level: 'error', rule: 'broken-link', page: '/', blockKey: '/#top', message: 'Broken link to /no-existe (404).' });
    const [page] = deriveChanges(s, run(emptyOverlay(), s, { type: 'addPlannedPage', path: '/no-existe', title: 'Nueva' }));
    expect(page).toMatchObject({ type: 'newPage', id: changeId('newPage', ['/no-existe']), observed: false });
    expect(page!.details.resolves).toEqual([{ id: 'broken-link|/|/#top|http://localhost:4405/no-existe', rule: 'broken-link', message: 'Broken link to /no-existe (404).' }]);
  });
});

describe('observedLink', () => {
  it('checks the scanned links of the owner, ignoring edits', () => {
    const s = linkedScan();
    const o = withComponents(s);
    expect(observedLink(s, o, '/#top', { block: '/otra#precios' })).toBe(true);
    expect(observedLink(s, o, '/#top', { page: '/no-existe' })).toBe(true);
    expect(observedLink(s, o, '/#top', { block: '/#cotizacion' })).toBe(false);
    const edited = run(o, s, { type: 'relink', owner: '/#top', linkText: 'Precios', linkHref: 'http://localhost:4405/otra#precios', to: { block: '/#cotizacion' } });
    expect(observedLink(s, edited, '/#top', { block: '/#cotizacion' })).toBe(false);
    expect(observedLink(s, edited, '/#top', { block: '/otra#precios' })).toBe(true);
  });
});

describe('confirmChange / reopenChange', () => {
  it('marks a change applied, keeps it through a re-scan, and a new target makes a new pending id', () => {
    const moved = after(moveIntegraciones);
    const id = deriveChanges(scan, moved)[0]!.id;
    const confirmed = run(moved, scan, confirm(id));
    const [change] = deriveChanges(scan, confirmed);
    expect(change).toMatchObject({ id, status: 'applied', confirmation: { by: 'test-agent', note: 'Moved the section in src/pages/otra.astro' } });
    expect(Date.parse(change!.confirmation!.at)).not.toBeNaN();

    const rescanned = reconcile(confirmed, scan, structuredClone(scan));
    expect(deriveChanges(scan, rescanned)[0]).toMatchObject({ id, status: 'applied' });

    const retargeted = run(
      rescanned,
      scan,
      { type: 'addPlannedPage', path: '/nueva', title: 'Nueva' },
      { type: 'moveBlock', blockKey: '/~integraciones', toPage: '/nueva', index: 0 },
    );
    const changes = deriveChanges(scan, retargeted);
    const move = only(changes, 'move');
    expect(move).toHaveLength(1);
    expect(move[0]).toMatchObject({ status: 'pending' });
    expect(move[0]!.id).not.toBe(id);
    expect(retargeted.confirmations[id]).toBeDefined();
    expect(changes.some((c) => c.id === id)).toBe(false);
  });

  it('rejects ids that are not in the current plan and empty notes', () => {
    const moved = after(moveIntegraciones);
    expect(() => run(moved, scan, confirm('move:0000000000'))).toThrow(OpError);
    expect(() => run(moved, scan, confirm('move:0000000000'))).toThrow(/Change move:0000000000 is not in the current plan\. Read the plan again\./);
    const id = deriveChanges(scan, moved)[0]!.id;
    expect(() => run(moved, scan, confirm(id, '   '))).toThrow(OpError);
    expect(() => run(moved, scan, confirm(id, ''))).toThrow(/note is required/);
  });

  it('reopenChange sets an applied change back to pending', () => {
    const moved = after(moveIntegraciones);
    const id = deriveChanges(scan, moved)[0]!.id;
    const confirmed = run(moved, scan, confirm(id));
    const reopened = run(confirmed, scan, { type: 'reopenChange', changeId: id, note: 'The section is still on /', by: 'test-agent' });
    expect(deriveChanges(scan, reopened)[0]).toMatchObject({ id, status: 'pending' });
    expect(reopened.confirmations[id]).toBeUndefined();
    expect(() => run(moved, scan, { type: 'reopenChange', changeId: id, note: 'x', by: 'a' })).toThrow(OpError);
    expect(() => run(confirmed, scan, { type: 'reopenChange', changeId: id, note: '', by: 'a' })).toThrow(/note is required/);
  });
});
