import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { OverlaySchema, emptyOverlay } from '../src/schema/overlay.js';
import { ScanSchema } from '../src/schema/scan.js';
import { computeIssues, type IssueContext } from '../src/scan/issues.js';
import { SiteStore } from '../src/store/store.js';
import { sampleScan } from './helpers/sample.js';

const SPANISH = /\b(el|la|los|las|de|del|para|una|sección|página|bloque|escaneo|sitio|enlace|alerta|etiqueta)\b|[áéíóúñ¿¡]/i;
/** Quoted and template string literals of the minified bundle. */
const LITERAL = new RegExp(['"(?:[^"\\\\\\n]|\\\\.)*"', "'(?:[^'\\\\\\n]|\\\\.)*'", '`(?:[^`\\\\]|\\\\.)*`'].join('|'), 'g');
const root = join(import.meta.dirname, '..');
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cli = (...args: string[]) => execFileSync(process.execPath, [tsx, 'src/cli.ts', ...args], { cwd: root, encoding: 'utf8' });

describe('English only', () => {
  it('no Spanish in MCP tool descriptions', async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(store).connect(a);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(b);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const texts = tools.flatMap((t) => [
      t.description ?? '',
      ...Object.values((t.inputSchema.properties ?? {}) as Record<string, { description?: string }>).map((p) => p.description ?? ''),
    ]);
    for (const text of texts) expect(text).not.toMatch(SPANISH);
  });

  it('no Spanish in CLI help', () => {
    const outputs = [cli('--help'), ...['scan', 'canvas', 'mcp'].map((c) => cli(c, '--help'))];
    for (const out of outputs) expect(out).not.toMatch(SPANISH);
  });

  it('no Spanish in issue messages', () => {
    const scan = sampleScan();
    const hero = scan.pages[0]!.blocks[1]!;
    hero.components.links = [
      { text: 'Go', href: 'http://localhost:4405/missing', kind: 'internal' },
      { text: 'Ghost', href: '#ghost', kind: 'anchor' },
      { text: 'Prices', href: 'http://localhost:4405/demo/otra#nada', kind: 'internal' },
    ];
    hero.components.media = [{ type: 'img', src: 'http://localhost:4405/demo/PLACEHOLDER.png', alt: '' }];
    const ctx: IssueContext = {
      linkStatus: new Map([['http://localhost:4405/missing', 404], ['http://localhost:4405/demo/otra', 200]]),
      idsByPath: new Map([['/', new Set(['top'])], ['/otra', new Set(['precios'])]]),
      pageInfo: new Map([['/', { h1Count: 0, duplicateIds: ['x'] }]]),
      pathOf: (url) => (url.startsWith('http://localhost:4405/demo/') ? '/' + url.slice('http://localhost:4405/demo/'.length) : null),
    };
    const issues = computeIssues(scan.pages, ctx);
    expect(new Set(issues.map((i) => i.rule))).toEqual(
      new Set(['broken-link', 'missing-anchor', 'form-no-action', 'placeholder-image', 'block-no-anchor', 'heading', 'duplicate-id']),
    );
    for (const i of issues) expect(i.message.replace(/"[^"]*"/g, '')).not.toMatch(SPANISH);
  });

  describe('built canvas', () => {
    let literals: string[] = [];
    beforeAll(async () => {
      const dir = join(root, 'dist', 'canvas', 'assets');
      const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));
      const code = (await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')))).join('\n');
      literals = (code.match(LITERAL) ?? []).filter((s) => s.length <= 200); // longer matches are mis-tokenized code, not UI copy
    }, 120_000);

    it('no Spanish in the built canvas', () => {
      expect(literals.length).toBeGreaterThan(100);
      expect(literals.filter((s) => SPANISH.test(s))).toEqual([]);
    });
  });

  it('migrates narrativa', () => {
    const v1 = sampleScan();
    v1.pages[0]!.blocks[2]!.kind = 'narrativa' as never;
    const scan = ScanSchema.parse(JSON.parse(JSON.stringify(v1)));
    expect(scan.pages[0]!.blocks[2]!.kind).toBe('narrative');
    const overlay = OverlaySchema.parse({ ...emptyOverlay(), kindOverrides: { k: 'narrativa' } });
    expect(overlay.kindOverrides.k).toBe('narrative');
  });
});
