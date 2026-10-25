import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { openBrowser, preparePage } from '../src/scan/browser.js';
import { extractBlocks } from '../src/scan/extract.js';
import { startStatic } from './helpers/static.js';

let server: Awaited<ReturnType<typeof startStatic>>;
let browser: Browser;

beforeAll(async () => {
  server = await startStatic('tests/fixtures/site');
  browser = await openBrowser();
});
afterAll(async () => {
  await browser.close();
  await server.close();
});

async function extract(file: string) {
  const { page, status } = await preparePage(browser, `${server.url}/${file}`);
  try {
    return { status, ...(await extractBlocks(page)) };
  } finally {
    await page.close();
  }
}

describe('extractBlocks', () => {
  it('detecta los bloques de index.html en orden, sin la etiqueta fija', async () => {
    const { raws, status } = await extract('index.html');
    expect(status).toBe(200);
    expect(raws.map((r) => r.tag)).toEqual(['header', 'section', 'section', 'section', 'section', 'footer']);
    expect(raws.map((r) => r.kicker ?? r.ariaLabel)).toEqual([null, 'Inicio', 'Integraciones', 'Pieza de impacto', 'Contacto', null]);
  });

  it('reconoce hero visual, ancla del envoltorio y formulario', async () => {
    const { raws } = await extract('index.html');
    const hero = raws[1]!;
    expect(hero.kicker).toBe('Inicio');
    expect(hero.anchor).toBe('top');
    expect(hero.visualRatio).toBeGreaterThanOrEqual(0.3);
    expect(raws[4]!.hasForm).toBe(true);
    expect(raws[4]!.components.forms[0]).toEqual({ fields: 3, action: null, method: 'get' });
    expect(raws[2]!.components.media.some((m) => m.src?.includes('PROVISIONAL'))).toBe(true);
  });

  it('combina estructura semántica y respaldo en páginas mixtas', async () => {
    const { raws } = await extract('mixto.html');
    expect(raws.map((r) => r.heading)).toEqual(['Mixto', 'Sección', 'Div uno', 'Div dos']);
  });

  it('respeta las marcas data-atlas-block', async () => {
    const { raws } = await extract('marcas.html');
    expect(raws).toHaveLength(3);
    expect(raws[0]!.atlasName).toBe('Bloque marcado');
  });

  it('reporta h1 e ids duplicados', async () => {
    const { pageInfo } = await extract('index.html');
    expect(pageInfo.h1Count).toBe(1);
    expect(pageInfo.ids).toContain('cotizacion');
    expect(pageInfo.duplicateIds).toEqual([]);
  });

  it('counts the role signals of each section of roles.html', async () => {
    const { raws } = await extract('roles.html');
    const by = (id: string) => raws.find((r) => r.anchor === id)!.signals;
    expect(by('features')).toMatchObject({ cards: 6, cardHeadingLevel: 3 });
    expect(by('two-up')).toMatchObject({ cards: 2 });
    expect(by('logos').smallImages).toBeGreaterThanOrEqual(8);
    expect(by('stats').bigNumbers).toBe(3);
    expect(by('testimonials').quotes).toBe(3);
    expect(by('pricing').prices).toBeGreaterThanOrEqual(3);
    expect(by('faq')).toMatchObject({ questions: 4, accordions: 4 });
    expect(by('steps').numbered).toBe(4);
    expect(by('products')).toMatchObject({ listItems: 6 });
    expect(by('products').largeImages).toBeGreaterThanOrEqual(1);
    expect(by('contact').contactHints).toBeGreaterThanOrEqual(1);
    expect(by('content').words).toBeGreaterThanOrEqual(150);
    expect(by('gallery').largeImages).toBeGreaterThanOrEqual(4);
    expect(by('banner').imageRatio).toBeGreaterThanOrEqual(0.3);
  });

  it('termina rápido en páginas enormes', async () => {
    const t0 = Date.now();
    const { raws } = await extract('alta.html');
    expect(raws).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});
