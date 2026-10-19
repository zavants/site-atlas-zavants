import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyOp } from '../src/model/ops.js';
import { runScan } from '../src/run.js';
import { SiteStore } from '../src/store/store.js';
import { startStatic } from './helpers/static.js';

let server: Awaited<ReturnType<typeof startStatic>>;
beforeAll(async () => {
  server = await startStatic('tests/fixtures/site');
});
afterAll(() => server.close());

describe('runScan', () => {
  it('no guarda ni concilia si la página inicial no se pudo escanear', async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    await store.writeOverlay('demo', { ...(await store.readOverlay('demo')), plannedDeletions: ['/#top'] }, 0);
    await expect(runScan(store, `${server.url}/nada.html`, { site: 'demo' })).rejects.toThrow(/No se pudo escanear/);
    expect(await store.latestScan('demo')).toBeNull();
    expect((await store.readOverlay('demo')).rev).toBe(1);
  });

  it('guarda el escaneo y conserva la capa del usuario al re-escanear', async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    const first = await runScan(store, `${server.url}/index.html`, { site: 'demo', maxPages: 2 });
    expect(first.overlay.rev).toBe(1);
    const tagged = applyOp(applyOp(first.overlay, first.scan, { type: 'createTag', name: 'Confianza' }), first.scan, {
      type: 'moveBlock',
      blockKey: '/~integraciones',
      toPage: '/otra',
      index: 0,
    });
    await store.writeOverlay('demo', tagged, first.overlay.rev);

    const second = await runScan(store, `${server.url}/index.html`, { site: 'demo', maxPages: 2 });
    expect(second.overlay.tags.map((t) => t.name)).toEqual(['Confianza']);
    expect(second.overlay.plannedOrder['/otra']).toEqual(['/~integraciones', '/otra#precios']);
    expect(second.overlay.orphans).toEqual([]);
    expect((await store.previousScan('demo'))?.scanId).toBe(first.scan.scanId);
  });
});
