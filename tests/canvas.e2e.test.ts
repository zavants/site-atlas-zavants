import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { t } from '../canvas/src/strings.js';
import { createMcpServer } from '../src/mcp/server.js';
import type { Change } from '../src/model/changes.js';
import type { SiteMap } from '../src/model/map.js';
import { runScan } from '../src/run.js';
import { createApp } from '../src/server/http.js';
import { SiteStore } from '../src/store/store.js';
import { startStatic } from './helpers/static.js';

let fixture: Awaited<ReturnType<typeof startStatic>>;
let app: ReturnType<typeof createApp>;
let server: ServerType;
let base: string;
let browser: Browser;
let store: SiteStore;
let page: Page;
let mcp: Client;

/** The canvas server on an OS-assigned port: no clash with other suites or a running Atlas. */
function listen(): Promise<string> {
  app = createApp(store);
  return new Promise((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info: AddressInfo) => resolve(`http://127.0.0.1:${info.port}`));
  });
}

beforeAll(async () => {
  fixture = await startStatic('tests/fixtures/site');
  store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
  await runScan(store, `${fixture.url}/index.html`, { site: 'demo', maxPages: 2 });
  await runScan(store, `${fixture.url}/hostil.html`, { site: 'hostil', maxPages: 1 });
  base = await listen();
  browser = await chromium.launch();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(store).connect(a);
  mcp = new Client({ name: 'e2e-agent', version: '0' });
  await mcp.connect(b);
}, 180_000);

afterAll(async () => {
  await mcp?.close();
  await browser?.close();
  app?.closeEvents();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await fixture?.close();
});

/** Opens the canvas and waits until it has laid out, fitted the camera and connected to SSE. */
async function open(site: string) {
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(10_000);
  await page.goto(`${base}/s/${site}`);
  await page.locator('[data-testid="viewport"][data-ready="true"][data-live="true"]').waitFor();
}

const diagram = (id: string) => page.locator(`[data-testid="diagram"][data-id="${id}"]`);
const piece = (diagramId: string, key: string) => diagram(diagramId).locator(`[data-testid="piece"][data-key="${key}"]`);
const serverMap = async (): Promise<SiteMap> => (await fetch(`${base}/api/sites/demo/map`)).json() as Promise<SiteMap>;
const changes = async (): Promise<Change[]> => ((await (await fetch(`${base}/api/sites/demo/plan`)).json()) as { changes: Change[] }).changes;
const pending = async (type: Change['type']) => (await changes()).filter((c) => c.type === type && c.status === 'pending');
const center = async (sel: ReturnType<typeof diagram>) => {
  const b = (await sel.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** Moves the mouse in `n` steps, calling `each` after every step (stepped pointer events, as in the prototype check). */
async function glide(from: { x: number; y: number }, to: { x: number; y: number }, n: number, each?: () => Promise<void>) {
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n);
    await each?.();
  }
}

/** Where the gap is: [diagram id, index among its drop zone's pieces], plus the floating piece's offset from the cursor. */
const gapState = () =>
  page.evaluate(() => {
    const hole = document.querySelector('[data-testid="piece"][data-hole="true"]');
    const zone = hole?.parentElement;
    const float = document.querySelector('[data-testid="piece"].float');
    const f = float?.getBoundingClientRect();
    return {
      diagram: hole?.closest('[data-testid="diagram"]')?.getAttribute('data-id') ?? null,
      index: zone ? Array.from(zone.querySelectorAll(':scope > [data-testid="piece"]')).indexOf(hole!) : -1,
      float: f ? { x: f.left, y: f.top } : null,
    };
  });

describe('org chart canvas', () => {
  let header: string;

  it('shows the Pages tab: pieces, a component without lines and a red line to NOT FOUND', async () => {
    await open('demo');
    header = (await serverMap()).components.find((c) => c.name === 'Header 1')!.id;
    const keys = await diagram('/').locator('[data-testid="piece"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
    expect(keys).toEqual(['/~header', '/#top', '/~integraciones', '/~pieza-de-impacto', '/#cotizacion', '/~footer']);
    await expect.poll(() => piece('/', '/~header').textContent()).toContain(t.piece.component);
    expect(await page.locator(`[data-testid="wire"][data-from="${header}"]`).count()).toBe(0);
    expect(await page.locator('[data-testid="wire"][data-from="/~header"]').count()).toBe(0);
    expect(await diagram('/no-existe').textContent()).toContain(t.diagram.notFound);
    const red = page.locator('[data-testid="wire"][data-from="/~integraciones"][data-to="/no-existe"]');
    await expect.poll(() => red.count()).toBe(1);
    expect(await red.getAttribute('data-color')).toBe('missing');
  });

  it('shows a component diagram with one line per link of the component', async () => {
    await page.locator(`[data-testid="show-component"][data-id="${header}"]`).click();
    await diagram(header).waitFor();
    const count = (await serverMap()).components.find((c) => c.id === header)!.block.links.length;
    await expect.poll(() => page.locator(`[data-testid="wire"][data-from="${header}"]`).count()).toBe(count);
    expect(await diagram(header).textContent()).toContain('/otra');
  });

  it('retargets a line by dragging its end circle onto another piece', async () => {
    const handle = page.locator(`[data-testid="wire-handle"][data-link="${header}|#cotizacion|Cotizar"]`);
    const target = piece('/otra', '/otra#precios');
    await glide(await center(handle), await center(handle), 1);
    await page.mouse.down();
    await glide(await center(handle), await center(target), 10);
    await page.mouse.up();
    await expect.poll(async () => (await pending('relink')).length).toBe(1);
    await expect.poll(() => page.locator(`[data-testid="wire"][data-link="${header}|#cotizacion|Cotizar"]`).getAttribute('data-color')).toBe('edited');
    await page.getByTestId('show-pages').click();
    await diagram('/').waitFor();
  });

  it('drags a piece live to another diagram at a zoom other than 100 %: the gap advances one step at a time', async () => {
    await page.getByTestId('zoom-reset').click();
    await page.getByTestId('zoom-out').click();
    await expect.poll(() => page.getByTestId('zoom-value').textContent()).toBe('83%');
    const src = piece('/', '/~integraciones');
    const box = (await src.boundingBox())!;
    const grab = { x: box.x + 40, y: box.y + 10 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    const seen: { diagram: string | null; index: number }[] = [];
    const offsets: { x: number; y: number }[] = [];
    let cursor = grab;
    const record = async () => {
      const s = await gapState();
      seen.push({ diagram: s.diagram, index: s.index });
      if (s.float) offsets.push({ x: s.float.x - cursor.x, y: s.float.y - cursor.y });
    };
    // Down through "/" (past two pieces), out through the empty space between the diagrams,
    // over the top of "/otra" and down into it past its piece. The gap stays put outside diagrams.
    const bottom = await center(piece('/', '/#cotizacion'));
    const home = (await diagram('/').boundingBox())!;
    const otraBox = (await diagram('/otra').boundingBox())!;
    const between = (home.x + home.width + otraBox.x) / 2;
    const otraX = otraBox.x + otraBox.width / 2;
    const steps: { x: number; y: number }[] = [
      { x: grab.x, y: bottom.y + 4 },
      { x: between, y: bottom.y + 4 },
      { x: between, y: otraBox.y - 20 },
      { x: otraX, y: otraBox.y - 20 },
      // The gap makes the diagram grow by one piece, so its old bottom edge stays inside.
      { x: otraX, y: otraBox.y + otraBox.height + 10 },
    ];
    for (const to of steps) {
      const from = cursor;
      for (let i = 1; i <= 16; i++) {
        cursor = { x: from.x + ((to.x - from.x) * i) / 16, y: from.y + ((to.y - from.y) * i) / 16 };
        await page.mouse.move(cursor.x, cursor.y);
        await record();
      }
    }
    await page.mouse.up();

    // The floating piece stays stuck to the grab point (within a pixel) at every step.
    expect(offsets.length).toBeGreaterThan(20);
    for (const o of offsets) {
      expect(Math.abs(o.x - offsets[0]!.x)).toBeLessThan(1.5);
      expect(Math.abs(o.y - offsets[0]!.y)).toBeLessThan(1.5);
    }
    // Within each diagram the gap only moves forward, one position at a time, and it visited both.
    for (const id of ['/', '/otra']) {
      const idx = seen.filter((s) => s.diagram === id).map((s) => s.index);
      expect(idx.length).toBeGreaterThan(0);
      for (let i = 1; i < idx.length; i++) expect(idx[i]! - idx[i - 1]!).toBeGreaterThanOrEqual(0);
      for (let i = 1; i < idx.length; i++) expect(idx[i]! - idx[i - 1]!).toBeLessThanOrEqual(1);
    }
    expect(new Set(seen.filter((s) => s.diagram === '/').map((s) => s.index)).size).toBeGreaterThan(1);
    expect(new Set(seen.filter((s) => s.diagram === '/otra').map((s) => s.index)).size).toBeGreaterThan(1);

    await expect.poll(async () => (await pending('move')).length).toBe(1);
    const otra = (await serverMap()).pages.find((p) => p.path === '/otra')!;
    expect(otra.blocks.map((b) => b.key)).toEqual(['/otra#precios', '/~integraciones']);
    await expect.poll(() => piece('/otra', '/~integraciones').count()).toBe(1);
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
  });

  it('undoes and redoes the last move through the history buttons', async () => {
    await page.getByTestId('undo').click();
    await expect.poll(async () => (await pending('move')).length).toBe(0);
    await expect.poll(() => piece('/', '/~integraciones').count()).toBe(1);
    expect((await pending('relink')).length).toBe(1);
    await page.getByTestId('redo').click();
    await expect.poll(async () => (await pending('move')).length).toBe(1);
    await expect.poll(() => piece('/otra', '/~integraciones').count()).toBe(1);
  });

  it('moves a diagram by its title without selecting text', async () => {
    const title = diagram('/otra').getByTestId('diagram-title');
    const a = await center(title);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await glide(a, { x: a.x + 60, y: a.y + 90 }, 8);
    await page.mouse.up();
    await expect.poll(async () => (await serverMap()).layout['/otra']).toBeTruthy();
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
  });

  it('creates a connector from a piece plug and offers to delete it on a click of its end circle', async () => {
    const top = piece('/', '/#top');
    await top.hover();
    const plug = page.locator('[data-testid="plug"][data-key="/#top"]');
    const from = await center(plug);
    const to = await center(diagram('/otra').getByTestId('diagram-title'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await glide(from, to, 12);
    await page.mouse.up();
    await expect.poll(async () => (await pending('addLink')).length).toBe(1);
    const wire = page.locator('[data-testid="wire"][data-from="/#top"][data-color="added"]');
    await expect.poll(() => wire.count()).toBe(1);
    const id = (await wire.getAttribute('data-link'))!;
    const handle = page.locator(`[data-testid="wire-handle"][data-link="${id}"]`);
    const h = await center(handle);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.up();
    const dialog = page.getByTestId('delete-connector-dialog');
    await expect.poll(() => dialog.evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
    await dialog.getByRole('button', { name: t.dialogs.deleteConnector }).click();
    await expect.poll(async () => (await pending('addLink')).length).toBe(0);
  });

  it('marks a piece for deletion by dropping it on the Delete diagram', async () => {
    const src = piece('/', '/~pieza-de-impacto');
    const a = await center(src);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await glide(a, await center(diagram('~delete')), 14);
    await page.mouse.up();
    await expect.poll(async () => (await pending('delete')).length).toBe(1);
    await expect.poll(() => piece('~delete', '/~pieza-de-impacto').count()).toBe(1);
  });

  it('creates a planned page with a normalized path and rejects duplicates inside the dialog', async () => {
    await page.getByTestId('new-page').click();
    const dialog = page.getByTestId('new-page-dialog');
    await dialog.getByLabel(t.dialogs.path).fill('otra/');
    await dialog.getByRole('button', { name: t.dialogs.createPage }).click();
    await expect.poll(() => dialog.getByRole('alert').textContent()).toBe(t.dialogs.pathExists);
    await dialog.getByLabel(t.dialogs.path).fill(' Precios//Nuevos/ ');
    await dialog.getByRole('button', { name: t.dialogs.createPage }).click();
    await diagram('/precios/nuevos').waitFor();
    expect(await diagram('/precios/nuevos').textContent()).toContain(t.diagram.planned);
    await expect.poll(async () => (await serverMap()).layout['/precios/nuevos']).toBeTruthy();
  });

  it('resets the history notice when another client writes: reload, clear history, show the notice', async () => {
    await page.reload();
    await page.locator('[data-testid="viewport"][data-ready="true"][data-live="true"]').waitFor();
    await expect.poll(() => page.getByTestId('undo').isDisabled()).toBe(true);
    const title = diagram('/otra').getByTestId('diagram-title');
    const a = await center(title);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await glide(a, { x: a.x + 30, y: a.y + 30 }, 5);
    await page.mouse.up();
    await expect.poll(() => page.getByTestId('undo').isEnabled()).toBe(true);

    const r = await mcp.callTool({ name: 'atlas_add_planned_page', arguments: { site: 'demo', path: '/from-agent', title: 'From agent' } });
    expect(r.isError).toBeFalsy();
    await expect.poll(() => page.getByText(t.historyReset).count(), { timeout: 10_000 }).toBe(1);
    await diagram('/from-agent').waitFor();
    expect(await page.getByTestId('undo').isDisabled()).toBe(true);
    expect(await page.getByTestId('redo').isDisabled()).toBe(true);
  });

  it('asks before resetting all changes', async () => {
    await page.getByTestId('reset').click();
    const dialog = page.getByTestId('reset-dialog');
    await expect.poll(() => dialog.textContent()).toContain(t.resetConfirm);
    await dialog.getByRole('button', { name: t.dialogs.cancel }).click();
    expect(await dialog.evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
  });

  it('lists the planned changes with their status and author', async () => {
    const panel = page.getByTestId('changes-panel');
    const n = (await changes()).length;
    await expect.poll(() => panel.locator('summary').textContent()).toContain(String(n));
    await panel.locator('summary').click();
    const text = (await panel.textContent())!;
    expect(text).toContain(t.changes.pending);
    expect(text).toContain('e2e-agent');
  });

  it('opens selectable details on a click, with tags that filter the pieces', async () => {
    const top = piece('/', '/#top');
    await top.locator('.lh').click();
    const details = top.locator('.det');
    await details.waitFor();
    expect(await details.evaluate((el) => getComputedStyle(el).userSelect)).toBe('text');
    expect(await details.textContent()).toContain(t.piece.type);
    page.once('dialog', (d) => void d.accept('Trust'));
    await page.getByTestId('new-tag').click();
    await details.getByLabel('Trust').check();
    await expect.poll(async () => (await serverMap()).pages[0]!.blocks.find((b) => b.key === '/#top')!.tags.length).toBe(1);
    await page.getByTestId('tag-filter').filter({ hasText: 'Trust' }).click();
    await expect.poll(() => piece('/', '/#cotizacion').evaluate((el) => getComputedStyle(el).opacity)).toBe('0.3');
    expect(await top.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.getByTestId('tag-filter').filter({ hasText: 'Trust' }).click();
    await top.locator('.lh').click();
    await expect.poll(() => details.count()).toBe(0);
  });

  it('shows every piece as its screenshot without overlapping diagrams in the Screenshots view', async () => {
    await page.getByTestId('view-screenshots').click();
    const pieces = page.locator('[data-testid="piece"]');
    await expect.poll(() => pieces.count()).toBeGreaterThan(5);
    await expect
      .poll(() => pieces.evaluateAll((els) => els.every((el) => { const img = el.querySelector('img.cap') as HTMLImageElement | null; return !!img && img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0; })))
      .toBe(true);
    const boxes = await page.locator('[data-testid="diagram"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `diagrams ${i} and ${j} overlap`).toBe(false);
      }
    }
    await page.getByTestId('view-diagram').click();
  });

  it('shows hostile site content as text', async () => {
    await page.close();
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(10_000);
    await page.goto(`${base}/s/hostil`);
    await page.locator('[data-testid="viewport"][data-ready="true"]').waitFor();
    await expect.poll(() => page.locator('[data-testid="piece"]').filter({ hasText: '<img src=x onerror="window.__pwned=1">' }).count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});
