import { mkdtemp, writeFile, mkdir, readFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { deriveSiteId, splitEnvironment } from '../src/store/paths.js';
import { SiteStore, StaleRevError } from '../src/store/store.js';
import { emptyOverlay } from '../src/schema/overlay.js';
import { sampleScan } from './helpers/sample.js';

const SITE = 'localhost-4405-demo';

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

  it('gives up on a stale lock it cannot remove instead of spinning', async () => {
    // A directory at the lock path is stale but unlink() fails on it on every platform.
    const lock = `${store.overlayFile('s')}.lock`;
    await mkdir(lock, { recursive: true });
    await utimes(lock, new Date(0), new Date(0));
    vi.useFakeTimers({ toFake: ['Date'] });
    const tick = setInterval(() => vi.setSystemTime(Date.now() + 1000), 5);
    try {
      await expect(store.updateOverlay('s', (o) => o)).rejects.toThrow(/locked/);
    } finally {
      clearInterval(tick);
      vi.useRealTimers();
    }
  }, 5000);

  it('keeps a mode per site next to its name', async () => {
    await store.saveScan(sampleScan());
    expect((await store.readSiteInfo(SITE)).mode).toBeNull();
    expect((await store.setSiteMode(SITE, 'advisory')).mode).toBe('advisory');
    await store.setSiteName(SITE, 'Demo');
    expect(await store.readSiteInfo(SITE)).toMatchObject({ name: 'Demo', mode: 'advisory' });
  });

  it('stores one advice per site, latest wins, summary capped at 200 characters', async () => {
    await store.saveScan(sampleScan());
    expect(await store.readAdvice(SITE)).toBeNull();
    const first = await store.writeAdvice(SITE, { by: 'claude-code', summary: ' Move pricing up ', markdown: '# Advice\n\nMove pricing up.' });
    expect(first).toMatchObject({ by: 'claude-code', summary: 'Move pricing up', markdown: '# Advice\n\nMove pricing up.' });
    expect(Date.parse(first.at)).toBeGreaterThan(0);
    await store.writeAdvice(SITE, { by: 'cli', summary: 'Second', markdown: 'Second' });
    expect((await store.readAdvice(SITE))?.summary).toBe('Second');
    await expect(store.writeAdvice(SITE, { by: 'x', summary: 'a'.repeat(201), markdown: '' })).rejects.toThrow(/200 characters/);
  });

  it('never publishes half a site.json when the name and the mode are set at once', async () => {
    await store.saveScan(sampleScan());
    for (let round = 0; round < 5; round++) {
      await Promise.all([store.setSiteName(SITE, `Demo ${'o'.repeat(4000)}`), store.setSiteMode(SITE, 'advisory')]);
      expect(await store.readSiteInfo(SITE)).toMatchObject({ site: SITE });
    }
  });

  it('publishes one whole advice when several are written at once', async () => {
    await store.saveScan(sampleScan());
    const writers = ['alice', 'bob', 'carol', 'dave'];
    const markdownOf = (by: string) => `# Advice by ${by}\n\n${by.repeat(20_000)}`;
    for (let round = 0; round < 5; round++) {
      const written = await Promise.allSettled(
        writers.map((by) => store.writeAdvice(SITE, { by, summary: `Summary by ${by}`, markdown: markdownOf(by) })),
      );
      expect(written.map((r) => (r.status === 'rejected' ? (r.reason as Error).message : 'fulfilled'))).toEqual(
        writers.map(() => 'fulfilled'),
      );
      const saved = await store.readAdvice(SITE);
      expect(writers).toContain(saved?.by);
      expect(saved?.summary).toBe(`Summary by ${saved?.by}`);
      expect(saved?.markdown).toBe(markdownOf(saved!.by));
    }
  });
});
