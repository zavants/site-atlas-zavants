import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { owner } from '../src/model/links.js';
import { getPlan, mutate } from '../src/model/service.js';
import { runScan } from '../src/run.js';
import { startCanvasServer } from '../src/server/serve.js';
import { SiteStore } from '../src/store/store.js';
import { startStatic } from './helpers/static.js';

/** path -> sha1 of every file under `dir`, so created, changed and deleted files all show up. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[relative(dir, full).replaceAll('\\', '/')] = createHash('sha1').update(await readFile(full)).digest('hex');
    }
  };
  await walk(dir);
  return out;
}

let siteDir: string;
let server: Awaited<ReturnType<typeof startStatic>>;
beforeAll(async () => {
  siteDir = await mkdtemp(join(tmpdir(), 'site-atlas-site-'));
  await cp('tests/fixtures/site', siteDir, { recursive: true });
  server = await startStatic(siteDir);
});
afterAll(() => server.close());

describe('anti-goal: Atlas never writes into the scanned site', () => {
  it('leaves the site folder untouched through scan, edits, plan, confirm, re-scan, canvas and MCP', async () => {
    const before = await snapshot(siteDir);
    expect(Object.keys(before).sort()).toEqual(['alta.html', 'hostil.html', 'index.html', 'marcas.html', 'mixto.html', 'otra.html']);

    const home = await mkdtemp(join(tmpdir(), 'site-atlas-home-'));
    const store = new SiteStore(home);
    const site = 'demo';
    const url = `${server.url}/index.html`;

    const first = await runScan(store, url, { site, maxPages: 3 });
    const linked = first.scan.pages.flatMap((p) => p.blocks.map((b) => ({ b, path: p.path }))).find(({ b }) => b.components.links.length > 0)!;
    const ownerId = owner(linked.b, first.overlay);
    const link = linked.b.components.links[0]!;

    await mutate(store, site, { type: 'moveBlock', blockKey: '/~integraciones', toPage: '/otra', index: 0 });
    await mutate(store, site, { type: 'relink', owner: ownerId, linkText: link.text, linkHref: link.href, to: { page: '/otra' } });
    await mutate(store, site, { type: 'addLink', owner: ownerId, to: { page: '/otra' }, label: 'Extra' });
    await mutate(store, site, { type: 'addPlannedPage', path: '/nueva', title: 'Nueva' });

    const plan = await getPlan(store, site);
    expect(plan.changes.length).toBeGreaterThan(0);
    await mutate(store, site, { type: 'confirmChange', changeId: plan.changes[0]!.id, note: 'Done in the repo', by: 'test-agent' });
    expect((await getPlan(store, site)).changes.some((c) => c.status !== 'pending')).toBe(true);

    await runScan(store, url, { site, maxPages: 3 });

    const canvas = await startCanvasServer(store, { port: 4820 });
    expect((await fetch(`${canvas.url}/api/health`)).ok).toBe(true);
    await canvas.close();

    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(store).connect(a);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(b);
    const opened = (await client.callTool({ name: 'atlas_open_canvas', arguments: { site } })) as { isError?: boolean };
    expect(opened.isError).toBeFalsy();
    await (await startCanvasServer(store)).close();
    await client.close();

    const after = await snapshot(siteDir);
    expect(after).toEqual(before);
    // The overlay and scans really were written, and only under SITE_ATLAS_HOME.
    expect(Object.keys(await snapshot(home)).length).toBeGreaterThan(0);
  }, 60_000);
});
