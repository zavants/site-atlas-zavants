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
const allInsideViewport = () =>
  page.evaluate(() => {
    const vp = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll('[data-testid="diagram"]')).every((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= vp.left && r.top >= vp.top && r.right <= vp.right && r.bottom <= vp.bottom;
    });
  });
/** Moves "/otra" by its title: one history step. Resolves once the tab's write is on the server. */
async function moveOtra() {
  const before = JSON.stringify((await serverMap()).layout['/otra']);
  const title = diagram('/otra').getByTestId('diagram-title');
  const a = await center(title);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await glide(a, { x: a.x + 30, y: a.y + 30 }, 5);
  await page.mouse.up();
  await expect.poll(() => page.getByTestId('undo').isEnabled()).toBe(true);
  await expect.poll(async () => JSON.stringify((await serverMap()).layout['/otra'])).not.toBe(before);
}
/** Opens a menu of the menu bar (Navigation, Filters, Views, Options) unless it is open already. */
async function openMenu(id: string) {
  const trigger = page.getByTestId(`menu-${id}`);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
}
const closeMenus = () => page.keyboard.press('Escape');
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
    await openMenu('navigation');
    await page.locator(`[data-testid="show-component"][data-id="${header}"]`).click();
    await diagram(header).waitFor();
    // Switching Show fits again: every diagram of the component view is inside the viewport.
    await expect.poll(() => allInsideViewport()).toBe(true);
    const count = (await serverMap()).components.find((c) => c.id === header)!.block.links.length;
    await expect.poll(() => page.locator(`[data-testid="wire"][data-from="${header}"]`).count()).toBe(count);
    expect(await diagram(header).textContent()).toContain('/otra');
  });

  it('renames a component from the Navigation menu, outside the undo history', async () => {
    const undoBefore = await page.getByTestId('undo').isEnabled();
    await openMenu('navigation');
    const button = page.locator(`[data-testid="show-component"][data-id="${header}"]`);
    await button.locator('xpath=..').getByTestId('rename-component-button').click();
    // Typed inline: embedded browsers may not support window.prompt.
    await page.getByTestId('rename-component').fill('Main header');
    await page.getByTestId('rename-component').press('Enter');
    await expect.poll(async () => (await serverMap()).components.find((c) => c.id === header)!.name).toBe('Main header');
    await expect.poll(() => button.textContent()).toBe('Main header');
    // The menu bar names the current view.
    expect(await page.getByTestId('menu-navigation').textContent()).toContain('Main header');
    await closeMenus();
    expect(await page.getByTestId('undo').isEnabled()).toBe(undoBefore);
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
    await openMenu('navigation');
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
    // The page stays painted mid-drag (a stray `body.dragging { opacity: 0 }` once blanked it).
    expect(await page.evaluate(() => [document.body.classList.contains('dragging'), getComputedStyle(document.body).opacity])).toEqual([true, '1']);
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
    await dialog.getByRole('button', { name: t.dialogs.linkAction.delete }).click();
    await expect.poll(async () => (await pending('addLink')).length).toBe(0);
  });

  it('lists the issues of a counter and filters by the detected tags', async () => {
    const m = await serverMap();
    await page.getByTestId('issues-warn').click();
    const panel = page.getByTestId('issues-panel');
    await expect.poll(() => panel.locator('li').count()).toBe(m.issueCount.warn);
    await page.getByTestId('issues-warn').click();
    expect(await panel.count()).toBe(0);

    await openMenu('filters');
    const chips = page.getByTestId('auto-tag');
    expect(await chips.count()).toBe(5);
    // The fixture's last section is its contact form: filtering by Contact dims every other piece.
    await page.locator('[data-testid="auto-tag"][data-id="auto:contact"]').click();
    await expect.poll(() => piece('/', '/#top').evaluate((el) => getComputedStyle(el).opacity)).toBe('0.3');
    expect(await piece('/', '/#cotizacion').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    // The active filter stays visible next to the menus, and clears from there.
    await closeMenus();
    expect(await page.getByTestId('active-filter').textContent()).toContain('Contact');
    await page.getByTestId('active-filter').getByRole('button').click();
    expect(await page.getByTestId('active-filter').count()).toBe(0);
  });

  it('shows the detected role on each piece and filters by it', async () => {
    const chips = page.locator('[data-testid="detected-tag"]');
    await expect.poll(() => chips.count()).toBeGreaterThan(5);
    expect(await chips.filter({ hasText: 'Default' }).count()).toBeLessThan(await chips.count() / 2);
    await openMenu('filters');
    const roleButtons = page.locator('[data-testid="auto-tag"]');
    expect(await roleButtons.count()).toBeGreaterThanOrEqual(3);
    await roleButtons.filter({ hasText: 'Hero' }).click();
    await closeMenus();
    await expect.poll(() => piece('/', '/#top').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await openMenu('filters'); await roleButtons.filter({ hasText: 'Hero' }).click(); await closeMenus();
  });

  it('overrides a role from the piece and the map remembers it', async () => {
    const top = piece('/', '/#top');
    await top.locator('.lh').click();
    await top.getByTestId('role-select').selectOption('banner');
    await expect.poll(async () => (await serverMap()).pages[0]!.blocks.find((b) => b.key === '/#top')!.effectiveRole).toBe('banner');
    expect(await top.locator('[data-testid="detected-tag"]').first().textContent()).toBe('Banner');
    await top.getByTestId('role-select').selectOption('auto');
    await expect.poll(async () => (await serverMap()).pages[0]!.blocks.find((b) => b.key === '/#top')!.roleOverridden).toBe(false);
    await top.locator('.lh').click();
  });

  it('removes every link to a NOT FOUND or external target from its ×, and the target goes away', async () => {
    const target = page.locator('[data-testid="diagram"]:is([data-kind="missing"], [data-kind="external"])').first();
    const id = (await target.getAttribute('data-id'))!;
    const before = (await pending('unlink')).length;
    await target.getByTestId('delete-page').click();
    const dialog = page.getByTestId('delete-page-dialog');
    await dialog.getByRole('button', { name: t.dialogs.removeLinks }).click();
    await expect.poll(async () => (await pending('unlink')).length).toBeGreaterThan(before);
    await expect.poll(() => page.locator(`[data-testid="diagram"][data-id=${JSON.stringify(id)}]`).count()).toBe(0);
    await page.getByTestId('undo').click();
    await expect.poll(async () => (await pending('unlink')).length).toBe(before);
  });

  it('removes a site link from its end circle and keeps it again', async () => {
    const wire = page.locator('[data-testid="wire"]:is([data-color="page"], [data-color="missing"], [data-color="section"])').first();
    const id = (await wire.getAttribute('data-link'))!;
    const clickEnd = async () => {
      const h = await center(page.locator(`[data-testid="wire-handle"][data-link=${JSON.stringify(id)}]`));
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      await page.mouse.up();
    };
    const dialog = page.getByTestId('delete-connector-dialog');
    await clickEnd();
    await dialog.getByRole('button', { name: t.dialogs.linkAction.remove }).click();
    await expect.poll(async () => (await pending('unlink')).length).toBe(1);
    await expect.poll(() => page.locator(`[data-testid="wire"][data-link=${JSON.stringify(id)}]`).getAttribute('data-color')).toBe('removed');
    await clickEnd();
    await dialog.getByRole('button', { name: t.dialogs.linkAction.restore }).click();
    await expect.poll(async () => (await pending('unlink')).length).toBe(0);
  });

  it('marks a piece for deletion by dropping it on the Delete diagram', async () => {
    const src = piece('/', '/~pieza-de-impacto');
    const a = await center(src);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await glide(a, await center(diagram('~delete')), 14);
    // Over the trash, a hint says the piece will be deleted on release.
    expect(await page.getByTestId('trash-hint').isVisible()).toBe(true);
    expect(await page.locator('.piece.float.doomed').count()).toBe(1);
    await page.mouse.up();
    expect(await page.getByTestId('trash-hint').count()).toBe(0);
    await expect.poll(async () => (await pending('delete')).length).toBe(1);
    await expect.poll(() => piece('~delete', '/~pieza-de-impacto').count()).toBe(1);
    // The trash is an icon whose badge counts the marked pieces; a click opens the list.
    await expect.poll(() => page.getByTestId('trash-badge').textContent()).toBe('1');
    expect(await piece('~delete', '/~pieza-de-impacto').isVisible()).toBe(false);
    await diagram('~delete').getByTestId('diagram-title').click();
    expect(await piece('~delete', '/~pieza-de-impacto').isVisible()).toBe(true);
    await diagram('~delete').getByTestId('diagram-title').click();
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

  it('does not park a diagram behind Delete: a page snaps back, a planned page asks to be deleted', async () => {
    const dropOnTrash = async (id: string) => {
      const a = await center(diagram(id).getByTestId('diagram-title'));
      const b = await center(diagram('~delete'));
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await glide(a, b, 10);
      // A diagram the trash would take turns red before release; a real page doesn't.
      expect(await diagram(id).evaluate((el) => el.classList.contains('doomed'))).toBe(id !== '/otra');
      await page.mouse.up();
    };
    await page.getByTestId("zoom-fit").click();
    const before = (await serverMap()).layout;
    await dropOnTrash('/otra');
    await dropOnTrash('/precios/nuevos');
    const dialog = page.getByTestId('delete-page-dialog');
    await expect.poll(() => dialog.evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
    await dialog.getByRole('button', { name: t.dialogs.cancel }).click();
    const after = (await serverMap()).layout;
    expect(after['/otra']).toEqual(before['/otra']);
    expect(after['/precios/nuevos']).toEqual(before['/precios/nuevos']);
  });

  it('resets the history notice when another client writes: reload, clear history, show the notice', async () => {
    await page.reload();
    await page.locator('[data-testid="viewport"][data-ready="true"][data-live="true"]').waitFor();
    await expect.poll(() => page.getByTestId('undo').isDisabled()).toBe(true);
    await moveOtra();

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
    // No window.prompt: the name is typed inline, since embedded browsers may not support prompt().
    await openMenu('filters');
    await page.getByTestId('new-tag').click();
    await page.getByTestId('new-tag-name').fill('Trust');
    await page.getByTestId('new-tag-name').press('Enter');
    await closeMenus();
    await details.getByLabel('Trust').check();
    await expect.poll(async () => (await serverMap()).pages[0]!.blocks.find((b) => b.key === '/#top')!.tags.length).toBe(1);
    await openMenu('filters');
    await page.getByTestId('tag-filter').filter({ hasText: 'Trust' }).click();
    await expect.poll(() => piece('/', '/#cotizacion').evaluate((el) => getComputedStyle(el).opacity)).toBe('0.3');
    expect(await top.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.getByTestId('tag-filter').filter({ hasText: 'Trust' }).click();
    await closeMenus();
    await top.locator('.lh').click();
    await expect.poll(() => details.count()).toBe(0);
  });

  it('shows every piece as its screenshot without overlapping diagrams in the Screenshots view', async () => {
    await openMenu('views');
    await page.getByTestId('view-screenshots').click();
    await closeMenus();
    const pieces = page.locator('[data-testid="piece"]');
    await expect.poll(() => pieces.count()).toBeGreaterThan(5);
    await expect
      .poll(() => pieces.evaluateAll((els) => els.every((el) => { if (el.closest('[data-id="~delete"]')) return true; const img = el.querySelector('img.cap') as HTMLImageElement | null; return !!img && img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0; })))
      .toBe(true);
    const all = await page.locator('[data-testid="diagram"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-id"), x: r.left, y: r.top, w: r.width, h: r.height }; }));
    // The trash is a fixed 36px button in the dock: it must not grow into a box that covers the canvas,
    // and diagrams may pan under the dock, so it stays out of the pairwise check.
    const trashBox = all.find((b) => b.id === '~delete')!;
    expect(trashBox.w, `trash box ${JSON.stringify(trashBox)}`).toBeLessThanOrEqual(40);
    expect(trashBox.h, `trash box ${JSON.stringify(trashBox)}`).toBeLessThanOrEqual(40);
    const boxes = all.filter((b) => b.id !== '~delete');
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `diagrams ${JSON.stringify(a)} and ${JSON.stringify(b)} overlap`).toBe(false);
      }
    }
    await openMenu('views');
    await page.getByTestId('view-diagram').click();
    await closeMenus();
  });

  it('shows or hides the optional bars from Views, and recolors detected tags from Options', async () => {
    await openMenu('views');
    await page.getByTestId('bar-navigation').check();
    await closeMenus();
    expect(await page.locator('.strip [data-testid="show-pages"]').count()).toBe(1);
    await openMenu('views');
    await page.getByTestId('bar-navigation').uncheck();
    await closeMenus();
    expect(await page.locator('.strip [data-testid="show-pages"]').count()).toBe(0);

    await openMenu('options');
    await page.getByTestId('open-tag-colors').click();
    const dialog = page.getByTestId('tag-colors-dialog');
    // Every role is listed, under the ids the canvas has always used; the fixture has a Contact section to recolor.
    await page.getByTestId('color-auto:form').fill('#ff0000');
    await page.getByTestId('color-auto:contact').fill('#ff0000');
    await expect.poll(() => page.locator('[data-testid="detected-tag"]', { hasText: 'Contact' }).first().evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 0, 0)');
    await dialog.getByRole('button', { name: t.options.reset }).click();
    await dialog.getByRole('button', { name: t.options.done }).click();
  });

  it('says that history was reset when a re-scan finishes', async () => {
    await moveOtra();
    const r = await fetch(`${base}/api/sites/demo/rescan`, { method: 'POST' });
    expect(r.ok).toBe(true);
    const notice = page.locator('.notice');
    await expect.poll(() => notice.textContent(), { timeout: 45_000 }).toContain(t.historyReset);
    expect(await notice.textContent()).toContain(t.head.scanDone);
    expect(await page.getByTestId('undo').isDisabled()).toBe(true);
  });

  it('resets to the real site, not to the state at load, as one undoable step', async () => {
    await page.reload();
    await page.locator('[data-testid="viewport"][data-ready="true"][data-live="true"]').waitFor();
    await moveOtra();
    expect((await changes()).length).toBeGreaterThan(0);

    await page.getByTestId('reset').click();
    await page.getByTestId('reset-dialog').getByRole('button', { name: t.dialogs.resetAll }).click();
    await expect.poll(async () => (await changes()).length).toBe(0);
    const fields = (await serverMap()).planFields;
    expect(fields).toEqual({ plannedOrder: {}, plannedPages: [], plannedDeletions: [], layout: {}, linkEdits: {}, addedLinks: [], removedLinks: {} });

    await page.getByTestId('undo').click();
    await expect.poll(async () => (await changes()).length).toBeGreaterThan(0);
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

describe('home page', () => {
  let home: Page;
  beforeAll(async () => {
    home = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    home.setDefaultTimeout(10_000);
    await home.goto(`${base}/s/`);
    await home.getByTestId('home').waitFor();
  });
  afterAll(() => home.close());

  const card = (site: string) => home.locator(`[data-testid="atlas-card"][data-site="${site}"]`);

  it('lists every atlas as a card with its size, plan progress and a prompt for an agent', async () => {
    await expect.poll(() => home.getByTestId('atlas-card').count()).toBeGreaterThanOrEqual(2);
    const demo = card('demo');
    expect(await demo.getByTestId('atlas-name').textContent()).toBe('demo');
    expect(await demo.textContent()).toMatch(/\d+ pages? · \d+ sections?/);
    expect(await demo.getByTestId('atlas-plan').textContent()).toMatch(/\d+ pending · \d+ applied/);
    await demo.locator('summary', { hasText: t.home.forAi }).click();
    expect(await demo.getByTestId('ai-prompt').textContent()).toContain('site-atlas plan demo');
  });

  it('renames an atlas in place and keeps its id', async () => {
    const demo = card('demo');
    await demo.getByTestId('atlas-rename').click();
    await demo.getByTestId('rename-input').fill('Demo site');
    await demo.getByTestId('rename-save').click();
    await expect.poll(() => demo.getByTestId('atlas-name').textContent()).toBe('Demo site');
    expect(await demo.textContent()).toContain('demo');
    expect((await fetch(`${base}/api/sites/demo/map`)).ok).toBe(true);
  });

  it('scans a pasted URL and opens its canvas when the scan finishes', async () => {
    await home.getByTestId('scan-url').fill(`${fixture.url}/hostil.html`);
    await home.locator('summary', { hasText: t.home.options }).click();
    await home.getByTestId('scan-max-pages').fill('1');
    await home.getByTestId('scan-start').click();
    await home.getByTestId('scan-progress').waitFor();
    await home.waitForURL(/\/s\/[^/]+$/, { timeout: 60_000 });
    await home.locator('[data-testid="viewport"][data-ready="true"]').waitFor();
    const site = decodeURIComponent(new URL(home.url()).pathname.replace('/s/', ''));
    expect(site).toMatch(/^127-0-0-1-\d+$/);
    expect(((await (await fetch(`${base}/api/sites`)).json()) as { site: string }[]).some((s) => s.site === site)).toBe(true);
  });

  it('deletes an atlas after a confirmation', async () => {
    await home.goto(`${base}/s/`);
    const hostil = card('hostil');
    await hostil.waitFor();
    await hostil.getByTestId('atlas-delete').click();
    await home.getByTestId('remove-confirm').click();
    await expect.poll(() => card('hostil').count()).toBe(0);
    expect((await fetch(`${base}/api/sites/hostil/map`)).status).toBe(404);
  });
});
