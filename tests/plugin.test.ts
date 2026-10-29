import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { SiteStore } from '../src/store/store.js';

const root = join(import.meta.dirname, '..');
const pluginDir = join(root, 'plugin');
const launcher = join(pluginDir, 'scripts', 'site-atlas-mcp.js');
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SKILLS = ['atlas', 'atlas-advise', 'atlas-apply', 'site-atlas-setup'];
const WINDOWS = process.platform === 'win32';
const NOT_FOUND =
  'Site Atlas CLI not found. Install it with: npm install -g site-atlas (then site-atlas setup), or set SITE_ATLAS_BIN.';

type Server = { command: string; args: string[]; cwd?: string };
type Manifest = {
  name: string;
  version: string;
  description: string;
  mcpServers?: Record<string, Server>;
  interface?: Record<string, string>;
};
type Marketplace = { name: string; plugins: { name: string; source: unknown; version?: string; description?: string }[] };
type Resolved = { command: string; args: string[] } | null;
type Spawned = { command: string; args: string[]; options: { windowsVerbatimArguments?: boolean } };
type Launcher = {
  resolveCli: (env: NodeJS.ProcessEnv, startDir: string) => Resolved;
  spawnArgs: (cli: { command: string; args: string[] }, platform: string, env: NodeJS.ProcessEnv) => Spawned;
};

const readJson = async <T>(...parts: string[]): Promise<T> => JSON.parse(await readFile(join(root, ...parts), 'utf8')) as T;
const temp = () => mkdtemp(join(tmpdir(), 'site-atlas-plugin-'));
const loadLauncher = async (): Promise<Launcher> => (await import(pathToFileURL(launcher).href)) as Launcher;
const cliHelp = () => execFileSync(process.execPath, [tsx, 'src/cli.ts', '--help'], { cwd: root, encoding: 'utf8' });

/** Every file that carries the release version, in the order set-version.mjs reports them. */
const VERSIONED = [
  'package.json',
  join('plugin', '.claude-plugin', 'plugin.json'),
  join('plugin', '.codex-plugin', 'plugin.json'),
  join('.claude-plugin', 'marketplace.json'),
  join('.agents', 'plugins', 'marketplace.json'),
];
const setVersion = join(root, 'scripts', 'set-version.mjs');

describe('plugin manifests', () => {
  it('every manifest parses and carries the version of the package', async () => {
    const pkg = await readJson<{ version: string }>('package.json');
    const claude = await readJson<Manifest>('plugin/.claude-plugin/plugin.json');
    const codex = await readJson<Manifest>('plugin/.codex-plugin/plugin.json');
    const market = await readJson<Marketplace>('.claude-plugin/marketplace.json');
    const agents = await readJson<Marketplace>('.agents/plugins/marketplace.json');
    const versions = [pkg.version, claude.version, codex.version, market.plugins[0]?.version];
    expect(versions).toHaveLength(4);
    expect(new Set(versions).size).toBe(1);
    for (const manifest of [claude, codex]) expect(manifest.name).toBe('site-atlas');
    expect(codex.description).toBe(claude.description);
    expect(market.plugins[0]).toMatchObject({ name: 'site-atlas', source: './plugin', description: claude.description });
    expect(agents.plugins[0]).toMatchObject({ name: 'site-atlas', source: { source: 'local', path: './plugin' } });
  });

  it('both agents start the same launcher under the same server name', async () => {
    const claude = await readJson<{ mcpServers: Record<string, Server> }>('plugin/.mcp.json');
    const codex = await readJson<Manifest>('plugin/.codex-plugin/plugin.json');
    const [claudeName, ...moreClaude] = Object.keys(claude.mcpServers);
    const [codexName, ...moreCodex] = Object.keys(codex.mcpServers ?? {});
    expect(moreClaude).toEqual([]);
    expect(moreCodex).toEqual([]);
    expect(claudeName).toBe('site-atlas');
    expect(codexName).toBe(claudeName);

    const forClaude = claude.mcpServers[claudeName!]!;
    const forCodex = codex.mcpServers![codexName!]!;
    expect(forClaude.command).toBe('node');
    expect(forCodex.command).toBe('node');
    expect(forClaude.args[0]).toBe('${CLAUDE_PLUGIN_ROOT}/scripts/site-atlas-mcp.js');
    expect(forClaude.cwd).toBeUndefined();
    expect(forCodex.cwd).toBe('./');
    expect(forCodex.args[0]).not.toContain('$');
    // The same file twice, so the two declarations cannot drift apart.
    expect(forClaude.args[0]!.replace('${CLAUDE_PLUGIN_ROOT}/', '')).toBe(forCodex.args[0]);
    expect(existsSync(join(pluginDir, forCodex.args[0]!))).toBe(true);
  });

  it('ships no bin and no commands directory', () => {
    expect(existsSync(join(pluginDir, 'bin'))).toBe(false);
    expect(existsSync(join(pluginDir, 'commands'))).toBe(false);
  });

  it('points the Codex interface at an icon that exists', async () => {
    const codex = await readJson<Manifest>('plugin/.codex-plugin/plugin.json');
    const face = codex.interface!;
    expect(face.displayName).toBe('Site Atlas');
    for (const key of ['composerIcon', 'logo']) {
      const file = face[key]!;
      expect(file, key).toMatch(/^\.\//);
      expect(existsSync(join(pluginDir, file)), file).toBe(true);
    }
  });
});

describe('plugin skills', () => {
  let docs: { name: string; text: string }[] = [];
  beforeAll(async () => {
    docs = await Promise.all([
      ...SKILLS.map(async (name) => ({ name, text: await readFile(join(pluginDir, 'skills', name, 'SKILL.md'), 'utf8') })),
      { name: 'README.md', text: await readFile(join(pluginDir, 'README.md'), 'utf8') },
    ]);
  });

  it('each skill declares its own name and says when to use it', () => {
    for (const doc of docs.filter((d) => d.name !== 'README.md')) {
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(doc.text)?.[1] ?? '';
      expect(front, doc.name).toMatch(new RegExp(`^name: ${doc.name}$`, 'm'));
      expect((/^description: (.+)$/m.exec(front)?.[1] ?? '').length, doc.name).toBeGreaterThan(40);
    }
  });

  it('every site-atlas subcommand the skills name exists', () => {
    const help = cliHelp();
    const commands = [...help.slice(help.indexOf('Commands:')).matchAll(/^ {2}([a-z][a-z-]*)/gm)].map((m) => m[1]!);
    expect(commands.length).toBeGreaterThan(10);
    expect(commands).toContain('advise');
    const named = new Set(docs.flatMap((d) => [...d.text.matchAll(/\bsite-atlas ([a-z][a-z-]*)/g)].map((m) => m[1]!)));
    expect(named.size).toBeGreaterThan(4);
    for (const name of named) expect(commands, name).toContain(name);
  });

  it('every atlas_ tool the skills name exists', async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(store).connect(a);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(b);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    const named = new Set(docs.flatMap((d) => [...d.text.matchAll(/\batlas_[a-z_]+/g)].map((m) => m[0])));
    expect(named.size).toBeGreaterThan(5);
    for (const name of named) expect(tools, name).toContain(name);
  });
});

describe('the MCP launcher', () => {
  it('honours SITE_ATLAS_BIN', async () => {
    const { resolveCli } = await loadLauncher();
    const dir = await temp();
    const script = join(dir, 'site-atlas.js');
    await writeFile(script, 'process.exit(0);\n');
    expect(resolveCli({ SITE_ATLAS_BIN: script, PATH: '' }, dir)).toEqual({ command: process.execPath, args: [script] });
    expect(resolveCli({ SITE_ATLAS_BIN: join(dir, 'site-atlas'), PATH: '' }, dir)).toEqual({
      command: join(dir, 'site-atlas'),
      args: [],
    });
  });

  it('finds a source checkout by walking up from the plugin folder', async () => {
    const { resolveCli } = await loadLauncher();
    const home = await temp();
    const found = resolveCli({ PATH: '', HOME: home, USERPROFILE: home }, join(pluginDir, 'scripts'));
    expect(found).toEqual({ command: process.execPath, args: [join(root, 'dist', 'cli.js')] });
  });

  it('finds nothing with an empty PATH and an empty home', async () => {
    const { resolveCli } = await loadLauncher();
    const home = await temp();
    expect(resolveCli({ PATH: '', HOME: home, USERPROFILE: home }, home)).toBeNull();
  });

  it('runs the CLI with mcp and forwards its exit code', async () => {
    const dir = await temp();
    const fake = join(dir, 'fake-cli.js');
    await writeFile(fake, 'console.log(process.argv.slice(2).join(" "));\nprocess.exit(0);\n');
    const run = spawnSync(process.execPath, [launcher], { encoding: 'utf8', env: { ...process.env, SITE_ATLAS_BIN: fake } });
    expect(run.status).toBe(0);
    expect(run.stdout.trim().split('\n').at(-1)).toBe('mcp');
  });

  it('exits 2 with one line when nothing is installed', async () => {
    const dir = await temp();
    const copy = join(dir, 'site-atlas-mcp.js');
    await copyFile(launcher, copy);
    const run = spawnSync(process.execPath, [copy], { encoding: 'utf8', cwd: dir, env: { PATH: '', HOME: dir, USERPROFILE: dir } });
    expect(run.status).toBe(2);
    expect(run.stderr.trim()).toBe(NOT_FOUND);
    expect(run.stdout).toBe('');
  });

  // The realistic case the shell would break: npm puts site-atlas.cmd under C:\Users\<name with a space>\…
  it('finds a CLI on the PATH whose folder has a space in it, and starts it', async () => {
    const dir = join(await temp(), 'Ana Lucia', 'npm');
    await mkdir(dir, { recursive: true });
    const shim = join(dir, WINDOWS ? 'site-atlas.cmd' : 'site-atlas');
    await writeFile(shim, WINDOWS ? '@echo off\r\n@echo ARGS:%*\r\n' : '#!/bin/sh\necho "ARGS:$*"\n', { mode: 0o755 });
    const home = await temp();
    const run = spawnSync(process.execPath, [launcher], {
      encoding: 'utf8',
      env: { PATH: dir, HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec },
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    // cmd.exe hands the shim its own quoting; what matters is that the path survived in one piece.
    expect(run.stdout.trim().split('\n').at(-1)).toMatch(/^ARGS:"?mcp"?$/);
  });

  it('quotes a Windows shim for the shell instead of concatenating it', async () => {
    const { spawnArgs } = await loadLauncher();
    const shim = 'C:\\Users\\Ana Lucia\\AppData\\Roaming\\npm\\site-atlas.cmd';
    const shell = 'C:\\Windows\\system32\\cmd.exe';
    const run = spawnArgs({ command: shim, args: [] }, 'win32', { ComSpec: shell });
    expect(run.command).toBe(shell);
    expect(run.args).toEqual(['/d', '/s', '/c', `""${shim}" "mcp""`]);
    expect(run.options).toEqual({ windowsVerbatimArguments: true });
  });

  it('starts anything else directly, with no shell in between', async () => {
    const { spawnArgs } = await loadLauncher();
    const script = '/opt/site atlas/dist/cli.js';
    for (const platform of ['linux', 'darwin', 'win32']) {
      const run = spawnArgs({ command: process.execPath, args: [script] }, platform, {});
      expect(run, platform).toEqual({ command: process.execPath, args: [script, 'mcp'], options: {} });
    }
  });

  it('runs when it is reached through a symlinked folder', async () => {
    const base = await temp();
    const real = join(base, 'real');
    await mkdir(real);
    await copyFile(launcher, join(real, 'site-atlas-mcp.js'));
    const link = join(base, 'link');
    await symlink(real, link, 'junction');
    const run = spawnSync(process.execPath, [join(link, 'site-atlas-mcp.js')], {
      encoding: 'utf8',
      env: { PATH: '', HOME: base, USERPROFILE: base },
    });
    expect(run.status).toBe(2);
    expect(run.stderr.trim()).toBe(NOT_FOUND);
  });
});

describe('set-version', () => {
  /** A temp copy of the five versioned files, with the Codex marketplace carrying a version too. */
  const copyManifests = async (): Promise<string> => {
    const dir = await temp();
    for (const file of VERSIONED) {
      await mkdir(join(dir, dirname(file)), { recursive: true });
      await copyFile(join(root, file), join(dir, file));
    }
    const agentsPath = join(dir, '.agents', 'plugins', 'marketplace.json');
    const agents = JSON.parse(await readFile(agentsPath, 'utf8')) as Marketplace;
    agents.plugins[0]!.version = '0.0.1';
    await writeFile(agentsPath, `${JSON.stringify(agents, null, 2)}\n`);
    return dir;
  };
  const readAll = async (dir: string): Promise<Record<string, string>> =>
    Object.fromEntries(await Promise.all(VERSIONED.map(async (f) => [f, await readFile(join(dir, f), 'utf8')] as const)));
  const changedLines = (before: string, after: string): string[] => {
    const old = before.split('\n');
    return after.split('\n').filter((line, i) => line !== old[i]);
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [setVersion, ...args], { encoding: 'utf8' });

  it('set-version updates every manifest and moves no other line', async () => {
    const dir = await copyManifests();
    const before = await readAll(dir);
    const written = run('9.9.9', dir);
    expect(written.stderr).toBe('');
    expect(written.status).toBe(0);
    const after = await readAll(dir);
    for (const file of VERSIONED) {
      expect(changedLines(before[file]!, after[file]!), file).toEqual([expect.stringContaining('"version": "9.9.9"')]);
      expect(written.stdout, file).toContain(file);
    }
  });

  it('leaves the Codex marketplace alone when its entry carries no version', async () => {
    const dir = await copyManifests();
    const agentsPath = join(dir, '.agents', 'plugins', 'marketplace.json');
    const agents = JSON.parse(await readFile(agentsPath, 'utf8')) as Marketplace;
    delete agents.plugins[0]!.version;
    await writeFile(agentsPath, `${JSON.stringify(agents, null, 2)}\n`);
    const before = await readFile(agentsPath, 'utf8');
    expect(run('9.9.9', dir).status).toBe(0);
    expect(await readFile(agentsPath, 'utf8')).toBe(before);
  });

  it('rejects a version that is not x.y.z', async () => {
    const dir = await copyManifests();
    const before = await readAll(dir);
    for (const bad of ['1.2', 'v1.2.3', '1.2.3-beta', '']) {
      const bailed = run(bad, dir);
      expect(bailed.status, bad).toBe(1);
      expect(bailed.stderr, bad).toMatch(/x\.y\.z/);
    }
    expect(await readAll(dir)).toEqual(before);
  });

  it('--check is what the release workflow runs: it fails until every manifest agrees', async () => {
    const dir = await copyManifests();
    const stale = run('--check', '9.9.9', dir);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('package.json');
    expect(run('9.9.9', dir).status).toBe(0);
    const agreed = run('--check', '9.9.9', dir);
    expect(agreed.stderr).toBe('');
    expect(agreed.status).toBe(0);
  });

  it('the checked-in tree agrees with its own package version', async () => {
    const pkg = await readJson<{ version: string }>('package.json');
    expect(run('--check', pkg.version, root).status).toBe(0);
  });
});
