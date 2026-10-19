import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SiteStore } from '../src/store/store.js';
import { sampleScan } from './helpers/sample.js';

function writer(home: string, site: string, count: number, label: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/helpers/writer.ts', home, site, String(count), label], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

describe('escrituras desde varios procesos', () => {
  it('no pierde cambios cuando dos procesos escriben la capa a la vez', async () => {
    const home = await mkdtemp(join(tmpdir(), 'site-atlas-test-'));
    const store = new SiteStore(home);
    const scan = sampleScan();
    await store.saveScan(scan);
    const codes = await Promise.all([writer(home, scan.site, 40, 'a'), writer(home, scan.site, 40, 'b')]);
    expect(codes).toEqual([0, 0]);
    const overlay = await store.readOverlay(scan.site);
    expect(overlay.tags).toHaveLength(80);
    expect(overlay.rev).toBe(80);
  }, 120_000);
});
