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
    expect(by('pricing').prices).toBe(3);
    expect(by('faq')).toMatchObject({ questions: 4, accordions: 4 });
    expect(by('steps').numbered).toBe(4);
    expect(by('products')).toMatchObject({ listItems: 6 });
    expect(by('products').largeImages).toBeGreaterThanOrEqual(1);
    expect(by('contact').contactHints).toBeGreaterThanOrEqual(1);
    expect(by('content').words).toBeGreaterThanOrEqual(150);
    expect(by('gallery').largeImages).toBeGreaterThanOrEqual(4);
    expect(by('banner').imageRatio).toBeGreaterThanOrEqual(0.3);
    // A band whose image is a CSS background reads like a banner too.
    expect(by('backdrop').imageRatio).toBeGreaterThanOrEqual(0.3);
  });

  it('measures a CSS background instead of assuming it fills the block', async () => {
    const { raws } = await extract('roles.html');
    const by = (id: string) => raws.find((r) => r.anchor === id)!.signals;
    // A backdrop is behind the block, not one of the images the block shows.
    expect(by('backdrop').largeImages).toBe(0);
    // A 24px icon painted once covers almost none of the band.
    expect(by('badge').imageRatio).toBeLessThan(0.05);
    expect(by('badge').largeImages).toBe(0);
    // A repeating tile is a texture: it is not one large image.
    expect(by('texture')).toMatchObject({ largeImages: 0, imageRatio: 0 });
  });

  it('counts one price per price, and only phone-shaped text as a contact hint', async () => {
    const { raws } = await extract('roles.html');
    const by = (id: string) => raws.find((r) => r.anchor === id)!.signals;
    // "1.234.567" and "2019 2020 2021" are numbers, not phones.
    expect(by('stats').contactHints).toBe(0);
    // A mailto link plus six phone shapes: "+598 2908 1234", "(02) 2908 1234",
    // "+598 99 123 456", "+1 (555) 123-4567", "(011) 4321-5678" and "+34 910 123 456".
    expect(by('contact').contactHints).toBe(7);
    // "$49/mes" is one price, not a currency match plus a period match.
    expect(by('feature').prices).toBe(1);
    // "+1.000.000" and "+25.000.000" are thousands-separated figures, not phones.
    expect(by('figures').contactHints).toBe(0);
  });

  it('leaves a hidden copy of a block out of the structural signals', async () => {
    const { raws } = await extract('roles.html');
    // The section ships one card twice: a wide copy and a display:none narrow copy.
    expect(raws.find((r) => r.anchor === 'responsive')!.signals).toMatchObject({
      cards: 0,
      listItems: 1,
      orderedItems: 1,
      numbered: 1,
      accordions: 2,
      questions: 1,
      tabs: 1,
      smallImages: 1,
      bigNumbers: 1,
      // One quote is visible and one is in the hidden copy; the only mailto is in the hidden copy.
      quotes: 1,
      contactHints: 0,
    });
  });

  it('counts the cards of a grid held by a display:contents wrapper', async () => {
    const { raws } = await extract('roles.html');
    // The wrapper generates no box of its own, which does not hide the cards inside it.
    expect(raws.find((r) => r.anchor === 'contents-grid')!.signals).toMatchObject({
      cards: 4,
      cardHeadingLevel: 3,
    });
  });

  it('termina rápido en páginas enormes', async () => {
    const t0 = Date.now();
    const { raws } = await extract('alta.html');
    expect(raws).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});
