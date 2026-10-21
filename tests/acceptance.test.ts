import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMap } from '../src/model/map.js';
import { reconcile } from '../src/model/reconcile.js';
import { emptyOverlay } from '../src/schema/overlay.js';
import { scanSite } from '../src/scan/scan.js';

const url = process.env.ATLAS_BETA1_URL;

describe.skipIf(!url)('aceptación: SCAP Tech Beta 1', () => {
  it('detecta los 15 bloques con sus nombres y las alertas esperadas en menos de 30 s', async () => {
    const shots = await mkdtemp(join(tmpdir(), 'site-atlas-test-acc-'));
    const t0 = Date.now();
    const scan = await scanSite(url!, { maxPages: 1, shotsDir: (id) => join(shots, id) });
    const elapsed = Date.now() - t0;

    const blocks = scan.pages[0]!.blocks;
    expect(blocks).toHaveLength(15);
    expect(blocks[0]!.tag).toBe('header');
    expect(blocks.at(-1)!.tag).toBe('footer');
    expect(blocks.slice(1, -1).map((b) => b.name)).toEqual([
      'Tecnología financiera',
      'Integraciones',
      'La plataforma',
      'Tecnología',
      'Gestión tecnológica',
      'Productos',
      'Soluciones',
      'Tecnología para brokers',
      'Para quién',
      'Cómo trabajamos',
      'Nosotros',
      'Tecnología de vanguardia. Control absoluto.',
      'Solicite una propuesta',
    ]);

    const byName = (n: string) => blocks.find((b) => b.name === n)!.key;
    const has = (rule: string, key: string, text?: string) =>
      scan.issues.some((i) => i.rule === rule && i.blockKey === key && (!text || i.message.includes(text)));
    expect(scan.issues.some((i) => i.rule === 'broken-link' && i.message.includes('/es/soluciones/brokers'))).toBe(true);
    expect(has('block-no-anchor', byName('Para quién'))).toBe(true);
    expect(has('block-no-anchor', byName('Cómo trabajamos'))).toBe(true);
    expect(has('placeholder-image', byName('Gestión tecnológica'))).toBe(true);
    expect(has('form-no-action', byName('Solicite una propuesta'))).toBe(true);
    expect(elapsed).toBeLessThan(30_000);

    // Org chart (spec §11.1): lines out of the pieces of `/`, and the shared header.
    const map = buildMap(scan, reconcile(emptyOverlay(), null, scan));
    const home = map.pages.find((p) => p.path === '/')!;
    const lines = home.blocks.filter((b) => !b.componentId).flatMap((b) => b.links.map((l) => ({ from: b.key, target: l.target })));
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l.from === '/#top')).toHaveLength(2);
    expect(lines.map((l) => l.target)).toContainEqual({ page: '/es/soluciones/brokers' });
    expect(lines.map((l) => l.target)).toContainEqual({ page: 'https://scapbroker.com' });
    expect(map.components.find((c) => c.name === 'Header 1')!.block.links).toHaveLength(7);
  }, 60_000);
});
