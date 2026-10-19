import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutate } from '../src/model/service.js';
import { runScan } from '../src/run.js';
import { createApp } from '../src/server/http.js';
import { SiteStore } from '../src/store/store.js';
import { sampleScan } from './helpers/sample.js';
import { startStatic } from './helpers/static.js';

let store: SiteStore;
let base: string;
let close: () => void;
let fixture: Awaited<ReturnType<typeof startStatic>>;

beforeAll(async () => {
  store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
  await store.saveScan(sampleScan());
  fixture = await startStatic('tests/fixtures/site');
  const app = createApp(store, { keepAliveMs: 100 });
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => {
    app.closeEvents();
    server.close();
  };
});
afterAll(async () => {
  close();
  await fixture.close();
});

function listen(site: string) {
  const ctrl = new AbortController();
  const events: string[] = [];
  const ready = fetch(`${base}/api/sites/${site}/events`, { signal: ctrl.signal }).then(async (res) => {
    const reader = res.body!.getReader();
    void (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        events.push(new TextDecoder().decode(value));
      }
    })().catch(() => undefined);
  });
  return { ctrl, events, ready };
}

describe('servidor en vivo', () => {
  it('un cliente que se desconecta no corta los avisos de los demás', async () => {
    const site = sampleScan().site;
    const a = listen(site);
    const b = listen(site);
    await Promise.all([a.ready, b.ready]);
    await new Promise((r) => setTimeout(r, 200));
    a.ctrl.abort();
    await new Promise((r) => setTimeout(r, 400));
    await mutate(store, site, { type: 'markDeleted', blockKey: '/#top' });
    await expect.poll(() => b.events.join('').includes('event: overlay'), { timeout: 3000 }).toBe(true);
    b.ctrl.abort();
  });

  it('re-escanea con la URL y las opciones originales', async () => {
    const first = await runScan(store, `${fixture.url}/index.html`, { site: 'fx', maxPages: 1 });
    const res = await fetch(`${base}/api/sites/fx/rescan`, { method: 'POST' });
    expect(res.status).toBe(202);
    await expect.poll(async () => (await store.latestScan('fx'))?.scanId, { timeout: 60_000 }).not.toBe(first.scan.scanId);
    const latest = (await store.latestScan('fx'))!;
    expect(latest.options).toEqual({ startUrl: `${fixture.url}/index.html`, maxPages: 1 });
    expect(latest.pages).toHaveLength(1);
  }, 90_000);
});
