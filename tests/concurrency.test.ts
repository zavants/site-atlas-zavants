import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SiteStore } from '../src/store/store.js';
import { wholeAdvice } from './helpers/advice.js';
import { sampleScan } from './helpers/sample.js';

function child(script: string, args: (string | number)[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', `tests/helpers/${script}`, ...args.map(String)], { stdio: 'inherit' });
    proc.on('exit', (code) => resolve(code ?? 1));
  });
}

const writer = (home: string, site: string, count: number, label: string) => child('writer.ts', [home, site, count, label]);

const adviceWriter = (home: string, site: string, count: number, by: string) => child('advice-writer.ts', [home, site, count, by]);

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

  it('never publishes advice signed by one agent with the markdown of another', async () => {
    const home = await mkdtemp(join(tmpdir(), 'site-atlas-test-'));
    const store = new SiteStore(home);
    const scan = sampleScan();
    await store.saveScan(scan);
    let reading = true;
    let reads = 0;
    const torn: string[] = [];
    // A reader in a third process sees the two files one pair at a time, never half of each writer.
    const reader = (async () => {
      while (reading) {
        const advice = await store.readAdvice(scan.site);
        reads++;
        if (advice && !wholeAdvice(advice)) torn.push(`${advice.summary} with the markdown of ${advice.markdown.slice(2, 20)}`);
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    const codes = await Promise.all([adviceWriter(home, scan.site, 25, 'alice'), adviceWriter(home, scan.site, 25, 'bob')]);
    reading = false;
    await reader;
    expect(codes).toEqual([0, 0]);
    expect(reads).toBeGreaterThan(10);
    expect(torn).toEqual([]);
    expect(wholeAdvice(await store.readAdvice(scan.site))).toBe(true);
  }, 120_000);
});
