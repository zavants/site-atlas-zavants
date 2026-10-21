import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SiteStore } from '../src/store/store.js';
import { sampleScan } from './helpers/sample.js';

const SITE = 'localhost-4405-demo';
const root = join(import.meta.dirname, '..');
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
type Run = { code: number; out: string; err: string };
type PlanJson = { schemaVersion: number; changes: { id: string; type: string; status: string; by: string; confirmation?: { by: string; note: string }; details: Record<string, unknown> }[] };

/** A CLI bound to its own store that holds the sample scan, so tests can run side by side. */
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'site-atlas-cli-'));
  const scan = sampleScan();
  scan.pages[0]!.blocks[1]!.components.links = [{ text: 'Ver', href: 'http://localhost:4405/no-existe', kind: 'internal' }];
  await new SiteStore(home).saveScan(scan);
  const cli = (...args: string[]) =>
    new Promise<Run>((resolve) => {
      execFile(process.execPath, [tsx, 'src/cli.ts', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, SITE_ATLAS_HOME: home } }, (error, out, err) => {
        resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, out, err });
      });
    });
  const plan = async (...args: string[]) => JSON.parse((await cli('plan', SITE, '--json', ...args)).out) as PlanJson;
  return { cli, plan };
}

const SLOW = { timeout: 180_000 };

describe.concurrent('CLI plan commands', () => {
  it('moves a section, prints it pending, then confirms it with a note', SLOW, async () => {
    const { cli, plan } = await setup();
    expect((await cli('move', SITE, '/~integraciones', '/otra', '--index', '0')).code).toBe(0);
    const pending = await plan();
    expect(pending.schemaVersion).toBe(2);
    expect(pending.changes).toHaveLength(1);
    expect(pending.changes[0]).toMatchObject({ type: 'move', status: 'pending' });

    const id = pending.changes[0]!.id;
    expect((await cli('confirm', SITE, id, '--note', 'done in src/pages/otra.astro')).code).toBe(0);
    const applied = await plan('--status', 'applied');
    expect(applied.changes.map((c) => c.id)).toEqual([id]);
    expect(applied.changes[0]!.confirmation).toMatchObject({ by: 'cli', note: 'done in src/pages/otra.astro' });
    expect((await plan('--status', 'pending')).changes).toEqual([]);

    expect((await cli('reopen', SITE, id, '--note', 'not deployed')).code).toBe(0);
    expect((await plan('--status', 'pending')).changes.map((c) => c.id)).toEqual([id]);
  });

  it('prints the Markdown plan by default, with all counts when filtered', SLOW, async () => {
    const { cli } = await setup();
    await cli('move', SITE, '/~integraciones', '/otra');
    const md = await cli('plan', SITE);
    expect(md.code).toBe(0);
    expect(md.out).toContain('# Site Atlas plan');
    expect(md.out).toContain('Move "Integraciones" from / to /otra');
    expect((await cli('plan', SITE, '--status', 'applied')).out).toContain('1 pending, 0 applied (showing applied)');
  });

  it('fails with exit code 1 and an English message', SLOW, async () => {
    const { cli, plan } = await setup();
    await cli('move', SITE, '/~integraciones', '/otra');
    const id = (await plan()).changes[0]!.id;
    const noNote = await cli('confirm', SITE, id);
    expect(noNote.code).toBe(1);
    expect(noNote.err).toContain('note is required');
    const stale = await cli('confirm', SITE, 'move:0000000000', '--note', 'x');
    expect(stale.code).toBe(1);
    expect(stale.err).toContain('is not in the current plan');
    const noBlock = await cli('delete', SITE, '/nope');
    expect(noBlock.code).toBe(1);
    expect(noBlock.err).toContain('No section /nope');
    expect((await cli('plan', 'unknown-site')).code).toBe(1);
    expect((await cli('plan', SITE, '--status', 'done')).code).toBe(1);
  });

  it('rejects arguments that Git Bash rewrote into a path', SLOW, async () => {
    const { cli } = await setup();
    const r = await cli('move', SITE, 'C:/Program Files/Git/~integraciones', '/otra');
    expect(r.code).toBe(1);
    expect(r.err).toContain('Argument "C:/Program Files/Git/~integraciones" looks like a path rewritten by Git Bash. Run with MSYS_NO_PATHCONV=1 (see README).');
    expect((await cli('delete', SITE, 'C:\\msys64\\usr\\bin\\x')).code).toBe(1);
    expect((await cli('--help')).out).toContain('MSYS_NO_PATHCONV=1');
    expect((await cli('plan', SITE, '--status', 'applied')).err).not.toContain('Git Bash');
  });

  it('manages pages, links, deletions and relinks', SLOW, async () => {
    const { cli, plan } = await setup();
    expect((await cli('page', 'add', SITE, '/nueva', '--title', 'Nueva')).code).toBe(0);
    expect((await plan()).changes.map((c) => c.type)).toEqual(['newPage']);

    expect((await cli('relink', SITE, '/#top', '--text', 'Ver', '--href', 'http://localhost:4405/no-existe', '--to-page', '/nueva')).code).toBe(0);
    const bad = await cli('relink', SITE, '/#top', '--text', 'Nada', '--href', '#x', '--to-page', '/nueva');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('No link "Nada" → #x in /#top.');
    expect((await cli('relink', SITE, '/#top', '--text', 'Ver', '--href', 'http://localhost:4405/no-existe')).code).toBe(1);
    expect((await plan()).changes.map((c) => c.type)).toEqual(['newPage', 'relink']);
    expect((await cli('page', 'remove', SITE, '/nueva')).code).toBe(0);
    expect((await plan()).changes).toEqual([]);

    expect((await cli('link', 'add', SITE, '/#top', '--to-block', '/#cotizacion', '--label', 'Cierre')).code).toBe(0);
    const [added] = (await plan()).changes;
    expect(added).toMatchObject({ type: 'addLink', by: 'cli' });
    expect((await cli('link', 'remove', SITE, added!.details.linkId as string)).code).toBe(0);
    expect((await plan()).changes).toEqual([]);

    expect((await cli('delete', SITE, '/otra#precios')).code).toBe(0);
    expect((await plan()).changes.map((c) => [c.type, c.by])).toEqual([['delete', 'cli']]);
    expect((await cli('restore', SITE, '/otra#precios')).code).toBe(0);
    expect((await plan()).changes).toEqual([]);
  });
});
