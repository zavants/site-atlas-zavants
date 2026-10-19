import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { deriveSiteId, splitEnvironment } from '../src/store/paths.js';
import { SiteStore, StaleRevError } from '../src/store/store.js';
import { emptyOverlay } from '../src/schema/overlay.js';
import { sampleScan } from './helpers/sample.js';

describe('rutas', () => {
  it('deriva el siteId de host, puerto y primer segmento', () => {
    expect(deriveSiteId('http://localhost:4405/beta-1/index.html')).toBe('localhost-4405-beta-1');
    expect(deriveSiteId('https://stripe.com/')).toBe('stripe-com');
    expect(deriveSiteId('http://localhost:3000/')).toBe('localhost-3000');
  });

  it('separa origen, ruta base y ruta de página', () => {
    expect(splitEnvironment('http://localhost:4405/beta-1/index.html')).toEqual({
      origin: 'http://localhost:4405',
      basePath: '/beta-1/',
      path: '/',
    });
    expect(splitEnvironment('https://stripe.com/')).toEqual({ origin: 'https://stripe.com', basePath: '/', path: '/' });
  });
});

describe('SiteStore', () => {
  let home: string;
  let store: SiteStore;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'site-atlas-test-'));
    store = new SiteStore(home);
  });

  it('devuelve una capa vacía para un sitio nuevo', async () => {
    expect(await store.readOverlay('nuevo')).toEqual(emptyOverlay());
  });

  it('incrementa rev y rechaza escrituras con rev viejo sin perder la anterior', async () => {
    const first = await store.writeOverlay('s', { ...emptyOverlay(), plannedDeletions: ['a'] }, 0);
    expect(first.rev).toBe(1);
    await expect(store.writeOverlay('s', { ...emptyOverlay(), plannedDeletions: ['b'] }, 0)).rejects.toBeInstanceOf(
      StaleRevError,
    );
    const onDisk = await store.readOverlay('s');
    expect(onDisk.rev).toBe(1);
    expect(onDisk.plannedDeletions).toEqual(['a']);
  });

  it('guarda escaneos y distingue el último del anterior', async () => {
    const a = sampleScan({ scanId: '2026-10-19T10-00-00.000Z' });
    const b = sampleScan({ scanId: '2026-10-19T11-00-00.000Z' });
    await store.saveScan(a);
    await store.saveScan(b);
    expect((await store.latestScan(a.site))?.scanId).toBe(b.scanId);
    expect((await store.previousScan(a.site))?.scanId).toBe(a.scanId);
    expect(await store.listSites()).toEqual([{ site: a.site, lastScan: b.scanId }]);
  });

  it('informa la ruta cuando overlay.json está corrupto y no lo reemplaza', async () => {
    const file = store.overlayFile('roto');
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, '{ no es json');
    await expect(store.readOverlay('roto')).rejects.toThrow(file);
    expect(await readFile(file, 'utf8')).toBe('{ no es json');
  });
});
