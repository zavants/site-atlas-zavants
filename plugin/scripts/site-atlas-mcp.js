#!/usr/bin/env node
// Starts the Site Atlas MCP server for the plugin, in Claude Code and in Codex alike.
//
// The plugin does not carry the CLI, it finds it: a global install, the installer's own folder, or a
// source checkout. Everything here is plain Node with no dependencies, because the plugin is copied
// as files and never installed as a package.
//
// It locates itself from import.meta.dirname, never from the working folder and never from an
// environment variable: Codex starts the server with the plugin as cwd and strips every plugin
// variable from its environment, so those two are not reliable anchors.

import { execFileSync, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WINDOWS = process.platform === 'win32';
/** On Windows the .cmd shim is the one CreateProcess can start; the extensionless file is a shell script. */
const NAMES = WINDOWS ? ['site-atlas.cmd', 'site-atlas'] : ['site-atlas', 'site-atlas.cmd'];
const NOT_FOUND =
  'Site Atlas CLI not found. Install it with: npm install -g site-atlas (then site-atlas setup), or set SITE_ATLAS_BIN.';

const isFile = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

const firstFile = (dir, names) => names.map((name) => join(dir, name)).find(isFile) ?? null;

/** A JavaScript entry point runs through this Node; anything else is an executable of its own. */
const asCommand = (file) => (/\.[cm]?js$/i.test(file) ? { command: process.execPath, args: [file] } : { command: file, args: [] });

const npmPrefix = (env) => {
  try {
    const out = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8', env, shell: WINDOWS, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || null;
  } catch {
    return null;
  }
};

/**
 * Where the site-atlas CLI is, as a command and its arguments, or null when it is nowhere.
 *
 * @param {NodeJS.ProcessEnv} env environment to read (PATH, HOME, SITE_ATLAS_BIN)
 * @param {string} startDir folder to walk up from when looking for a source checkout
 * @returns {{ command: string, args: string[] } | null}
 */
export function resolveCli(env = process.env, startDir = import.meta.dirname) {
  const chosen = (env.SITE_ATLAS_BIN ?? '').trim();
  if (chosen) return asCommand(chosen);

  const path = env.PATH ?? env.Path ?? '';
  for (const entry of path.split(delimiter)) {
    const dir = entry.replace(/^"|"$/g, '').trim();
    const onPath = dir ? firstFile(dir, NAMES) : null;
    if (onPath) return asCommand(onPath);
  }

  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  for (const dir of [join(home, '.site-atlas', 'npm', 'bin'), join(home, '.local', 'bin')]) {
    const installed = firstFile(dir, NAMES);
    if (installed) return asCommand(installed);
  }

  // npm itself comes from the PATH, so without one there is nothing to ask.
  if (path) {
    const prefix = npmPrefix(env);
    const global = prefix ? firstFile(WINDOWS ? prefix : join(prefix, 'bin'), NAMES) : null;
    if (global) return asCommand(global);
  }

  for (let dir = startDir; ; ) {
    const built = join(dir, 'dist', 'cli.js');
    if (isFile(built)) return asCommand(built);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  return null;
}

function main() {
  const cli = resolveCli(process.env, import.meta.dirname);
  if (!cli) {
    process.stderr.write(`${NOT_FOUND}\n`);
    process.exit(2);
  }
  const child = spawn(cli.command, [...cli.args, 'mcp'], { stdio: 'inherit', shell: /\.(cmd|bat)$/i.test(cli.command) });
  child.on('error', (error) => {
    process.stderr.write(`Site Atlas CLI could not be started (${cli.command}): ${error.message}\n`);
    process.exit(2);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
