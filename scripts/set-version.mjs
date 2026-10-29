#!/usr/bin/env node
// The release version lives in several manifests at once: the package, both plugin manifests and both
// marketplaces. This sets them all, or checks they agree.
//
//   node scripts/set-version.mjs 0.2.0           bump every manifest
//   node scripts/set-version.mjs --check 0.2.0   verify they agree (the release workflow runs this against the tag)
//
// It rewrites one line per file and nothing else, so hand-made formatting survives a bump.
// A trailing argument points at another tree, which the tests use.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/;
const USAGE = 'Usage: node scripts/set-version.mjs [--check] <x.y.z> [root]';

/** Every place a version lives: how to read it back, where its own key starts, and whether it has to be there. */
const TARGETS = [
  { file: 'package.json', read: (j) => j.version, after: null, required: true },
  { file: join('plugin', '.claude-plugin', 'plugin.json'), read: (j) => j.version, after: null, required: true },
  { file: join('plugin', '.codex-plugin', 'plugin.json'), read: (j) => j.version, after: null, required: true },
  { file: join('.claude-plugin', 'marketplace.json'), read: (j) => j.plugins?.[0]?.version, after: '"plugins"', required: true },
  { file: join('.agents', 'plugins', 'marketplace.json'), read: (j) => j.plugins?.[0]?.version, after: '"plugins"', required: false },
];

const die = (message) => {
  console.error(message);
  process.exit(1);
};

/** The file's text with its version replaced, or `null` when it already reads `version`. */
const retarget = (target, text, version) => {
  const from = target.after ? text.indexOf(target.after) : 0;
  if (from < 0) return die(`${target.file}: no ${target.after} to look under`);
  const key = /"version"(\s*):(\s*)"[^"]*"/g;
  key.lastIndex = from;
  const found = key.exec(text);
  if (!found) return die(`${target.file}: no "version" to set`);
  const next = `${text.slice(0, found.index)}"version"${found[1]}:${found[2]}"${version}"${text.slice(found.index + found[0].length)}`;
  if (target.read(JSON.parse(next)) !== version) return die(`${target.file}: rewriting the version did not land where it is read`);
  return next;
};

const [first, ...rest] = process.argv.slice(2);
const check = first === '--check';
const [version, root = join(dirname(fileURLToPath(import.meta.url)), '..')] = check ? rest : [first, ...rest];
if (!version || !SEMVER.test(version)) die(`${USAGE}\nA version is three numbers, x.y.z — not ${version ? `"${version}"` : 'nothing'}.`);

const edits = [];
const wrong = [];
for (const target of TARGETS) {
  const path = join(root, target.file);
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    if (target.required) die(`${target.file}: not found under ${root}`);
    continue;
  }
  const current = target.read(JSON.parse(text));
  // The Codex marketplace may carry no version of its own; nothing to set and nothing to check.
  if (current === undefined) {
    if (target.required) die(`${target.file}: no version to set`);
    continue;
  }
  if (current === version) continue;
  if (check) wrong.push(`${target.file}: ${current}`);
  else edits.push([path, target.file, retarget(target, text, version)]);
}

if (check) {
  if (wrong.length) die([`Every manifest must read ${version}, but:`, ...wrong].join('\n  '));
  process.exit(0);
}
for (const [path, , text] of edits) await writeFile(path, text);
for (const [, file] of edits) console.log(`${file} -> ${version}`);
if (!edits.length) console.log(`Already ${version} everywhere.`);
