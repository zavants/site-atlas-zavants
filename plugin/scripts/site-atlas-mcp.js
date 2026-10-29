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
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * How to start a command that Windows cannot start by itself, `npm` and the `.cmd` shims among them:
 * through cmd.exe, every token quoted and the whole line quoted again, which is the pair `cmd /s` strips.
 * Not `shell: true`, which Node deprecates for concatenating arguments it does not escape.
 *
 * @returns {{ command: string, args: string[], options: object }}
 */
const throughCmd = (env, command, args) => ({
  command: env.ComSpec ?? 'cmd.exe',
  args: ['/d', '/s', '/c', `"${[command, ...args].map((part) => `"${part}"`).join(' ')}"`],
  options: { windowsVerbatimArguments: true },
});

/** The same command run directly, for every platform that can. */
const directly = (command, args) => ({ command, args, options: {} });

const npmPrefix = (env) => {
  try {
    const npm = WINDOWS ? throughCmd(env, 'npm', ['prefix', '-g']) : directly('npm', ['prefix', '-g']);
    const out = execFileSync(npm.command, npm.args, {
      ...npm.options,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
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

/**
 * How to start the CLI with `mcp`: the command, its arguments and the extra spawn options.
 *
 * @param {{ command: string, args: string[] }} cli the resolved CLI
 * @param {string} platform process.platform of the host
 * @param {NodeJS.ProcessEnv} env environment to read (ComSpec)
 * @returns {{ command: string, args: string[], options: object }}
 */
export function spawnArgs(cli, platform = process.platform, env = process.env) {
  const argv = [...cli.args, 'mcp'];
  return platform === 'win32' && /\.(cmd|bat)$/i.test(cli.command)
    ? throughCmd(env, cli.command, argv)
    : directly(cli.command, argv);
}

/** The real path of a file, or the path itself when it cannot be resolved. */
const realPath = (file) => {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};

function main() {
  const cli = resolveCli(process.env, import.meta.dirname);
  if (!cli) {
    process.stderr.write(`${NOT_FOUND}\n`);
    process.exit(2);
  }
  const run = spawnArgs(cli);
  const child = spawn(run.command, run.args, { ...run.options, stdio: 'inherit' });
  child.on('error', (error) => {
    process.stderr.write(`Site Atlas CLI could not be started (${cli.command}): ${error.message}\n`);
    process.exit(2);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

// Both sides through realpath: Node's loader resolves the entry through symlinks and junctions while
// argv[1] keeps the path as it was given, so comparing them raw would skip main() and exit 0 in silence.
if (process.argv[1] && realPath(fileURLToPath(import.meta.url)) === realPath(process.argv[1])) main();
