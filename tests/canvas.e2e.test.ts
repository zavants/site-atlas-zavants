import { execSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutate } from '../src/model/service.js';
import { runScan } from '../src/run.js';
import { startCanvasServer } from '../src/server/serve.js';
import { SiteStore } from '../src/store/store.js';
import { startStatic } from './helpers/static.js';

let fixture: Awaited<ReturnType<typeof startStatic>>;
let canvas: Awaited<ReturnType<typeof startCanvasServer>>;
let browser: Browser;
let store: SiteStore;
let page: Page;

beforeAll(async () => {
  execSync('pnpm exec vite build canvas', { stdio: 'ignore' });
  fixture = await startStatic('tests/fixtures/site');
  store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
  await runScan(store, `${fixture.url}/index.html`, { site: 'demo', maxPages: 2 });
  await runScan(store, `${fixture.url}/hostil.html`, { site: 'hostil', maxPages: 1 });
  canvas = await startCanvasServer(store, { port: 4890 });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await canvas?.close();
  await fixture?.close();
});

async function open(site: string) {
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${canvas.url}/s/${site}`);
  await page.getByTestId('page-column').first().waitFor();
}

const card = (key: string) => page.locator(`[data-testid="block-card"][data-key="${key}"]`);
const column = (path: string) => page.locator(`[data-testid="page-column"][data-path="${path}"]`);

async function drag(from: string, toSelector: string) {
  const a = (await page.locator(from).boundingBox())!;
  const b = (await page.locator(toSelector).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 20);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + ((b.x + b.width / 2 - a.x) * i) / 12, a.y + 20 + ((b.y + 40 - a.y) * i) / 12);
  await page.mouse.up();
}

const serverMap = async (site: string) => (await (await fetch(`${canvas.url}/api/sites/${site}/map`)).json());

describe('lienzo', () => {
  it('muestra una columna por página y el carril global', async () => {
    await open('demo');
    expect(await page.getByTestId('page-column').count()).toBe(2);
    await expect.poll(() => page.getByTestId('global-lane').getByTestId('block-card').count()).toBe(2);
  });

  it('mueve un bloque a otra página arrastrando en Planned mode', async () => {
    await page.getByTestId('toggle-planned').click();
    await drag('[data-testid="block-card"][data-key="/~integraciones"]', '[data-testid="page-column"][data-path="/otra"] [data-testid="block-card"]');
    await expect.poll(async () => (await serverMap('demo')).pages[1].blocks.some((b: { key: string }) => b.key === '/~integraciones')).toBe(true);
    await expect.poll(() => column('/otra').locator('[data-key="/~integraciones"]').count()).toBe(1);
  });

  it('crea una etiqueta, la asigna y filtra', async () => {
    page.once('dialog', (d) => void d.accept('Confianza'));
    await page.getByTestId('new-tag').click();
    await card('/#top').getByTestId('edit-tags').click();
    await card('/#top').getByLabel('Confianza').check();
    await page.getByTestId('tag-filter').filter({ hasText: 'Confianza' }).click();
    await expect.poll(() => card('/#cotizacion').evaluate((el) => getComputedStyle(el).opacity)).toBe('0.3');
    expect(await card('/#top').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.getByTestId('tag-filter').filter({ hasText: 'Confianza' }).click();
  });

  it('marca un bloque para eliminar al soltarlo en la papelera', async () => {
    await drag('[data-testid="block-card"][data-key="/#cotizacion"]', '[data-testid="trash-zone"]');
    await expect.poll(() => card('/#cotizacion').getAttribute('class')).toMatch(/deleted/);
  });

  it('refleja cambios hechos por otro cliente sin recargar', async () => {
    await mutate(store, 'demo', { type: 'addPlannedPage', path: '/soluciones', title: 'Soluciones' });
    await expect.poll(() => column('/soluciones').count(), { timeout: 5000 }).toBe(1);
  });

  it('muestra como texto el contenido hostil del sitio', async () => {
    await page.close();
    await open('hostil');
    await expect.poll(() => page.getByText('<img src=x onerror="window.__pwned=1">').first().isVisible()).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});
