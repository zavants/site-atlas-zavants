import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanSite } from '../src/scan/scan.js';
import type { Scan } from '../src/schema/scan.js';
import { startStatic } from './helpers/static.js';

let server: Awaited<ReturnType<typeof startStatic>>;
let shots: string;
let scan: Scan;

beforeAll(async () => {
  server = await startStatic('tests/fixtures/site', { redirects: { '/viejo': '/otra', '/otra/': '/otra' } });
  shots = await mkdtemp(join(tmpdir(), 'site-atlas-test-shots-'));
  scan = await scanSite(`${server.url}/index.html`, { shotsDir: (id) => join(shots, id) });
});
afterAll(() => server.close());

describe('scanSite', () => {
  it('rastrea las páginas del sitio y no trata un 404 como página', () => {
    expect(scan.pages.map((p) => p.path)).toEqual(['/', '/otra']);
    expect(scan.pages.every((p) => p.status === 200)).toBe(true);
  });

  it('nombra, clasifica y da clave a los bloques', () => {
    const home = scan.pages[0]!;
    expect(home.blocks.map((b) => b.name)).toEqual(['Header', 'Inicio', 'Integraciones', 'Pieza de impacto', 'Contacto', 'Footer']);
    expect(home.blocks.map((b) => b.key)).toEqual([
      '/~header', '/#top', '/~integraciones', '/~pieza-de-impacto', '/#cotizacion', '/~footer',
    ]);
    expect(home.blocks[1]!.kind).toBe('visual');
    expect(home.blocks[4]!.kind).toBe('conversion');
  });

  it('marca header y footer como globales', () => {
    const globals = scan.pages.flatMap((p) => p.blocks.filter((b) => b.global).map((b) => `${p.path} ${b.name}`));
    expect(globals.sort()).toEqual(['/ Footer', '/ Header', '/otra Footer', '/otra Header']);
  });

  it('marks landmarks as components', () => {
    const home = scan.pages[0]!;
    const flag = (key: string) => home.blocks.find((b) => b.key === key)!.isComponent;
    expect(flag('/~header')).toBe(true);
    expect(flag('/~footer')).toBe(true);
    expect(flag('/#top')).toBe(false);
  });

  it('genera alertas del sitio', () => {
    const r = scan.issues.map((i) => i.rule);
    expect(r).toEqual(expect.arrayContaining(['broken-link', 'missing-anchor', 'form-no-action', 'placeholder-image', 'block-no-anchor']));
    expect(scan.issues.find((i) => i.rule === 'broken-link')?.message).toContain('/no-existe');
  });

  it('guarda una miniatura WebP por bloque', async () => {
    const files = await readdir(join(shots, scan.scanId));
    const withShot = scan.pages.flatMap((p) => p.blocks).filter((b) => b.shot);
    expect(withShot.length).toBeGreaterThanOrEqual(8);
    expect(files.every((f) => f.endsWith('.webp'))).toBe(true);
  });

  it('no duplica páginas por barras finales ni redirecciones', () => {
    expect(scan.pages.map((p) => p.path)).toEqual(['/', '/otra']);
  });

  it('registra las rutas que no existen y cómo se lanzó', () => {
    expect(scan.missingPages).toEqual(['/no-existe']);
    expect(scan.options).toEqual({ startUrl: `${server.url}/index.html` });
  });

  it('adopta el origen final si la URL inicial redirige a otro origen', async () => {
    const front = await startStatic('tests/fixtures/site', { redirects: { '/': `${server.url}/index.html` } });
    try {
      const s = await scanSite(`${front.url}/`, { maxPages: 2, shotsDir: (id) => join(shots, `redir-${id}`) });
      expect(s.environment.origin).toBe(server.url);
      expect(s.pages.map((p) => p.path)).toEqual(['/', '/otra']);
    } finally {
      await front.close();
    }
  });

  it('respeta maxPages', async () => {
    const one = await scanSite(`${server.url}/index.html`, { maxPages: 1, shotsDir: (id) => join(shots, `one-${id}`) });
    expect(one.pages.map((p) => p.path)).toEqual(['/']);
  });
});
