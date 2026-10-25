import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { en } from './i18n/en.js';
import { defaultCanvasDir } from './server/http.js';
import type { SiteStore } from './store/store.js';
import { VERSION } from './version.js';

export const MIN_NODE = 24;

/** The `playwright` CLI shipped with the dependency, so `setup` installs exactly the Chromium this version expects. */
function playwrightCli(): string {
  const pkg = createRequire(import.meta.url).resolve('playwright/package.json');
  return join(dirname(pkg), 'cli.js');
}

/** Downloads Chromium into Playwright's cache (or PLAYWRIGHT_BROWSERS_PATH). Returns the exit code. */
export function installChromium(opts: { withDeps: boolean }): Promise<number> {
  const args = [playwrightCli(), 'install', ...(opts.withDeps ? ['--with-deps'] : []), 'chromium'];
  return new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolveCode(code ?? 1));
  });
}

export interface Check {
  ok: boolean;
  text: string;
}

/** What `site-atlas doctor` reports. Pure checks: nothing is downloaded or started. */
export async function doctor(store: SiteStore): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  checks.push({ ok: major >= MIN_NODE, text: en.cli.doctorNode(process.versions.node, MIN_NODE) });
  checks.push({ ok: true, text: en.cli.doctorVersion(VERSION, resolve(dirname(fileURLToPath(import.meta.url)), '..')) });

  try {
    mkdirSync(store.home, { recursive: true });
    accessSync(store.home, constants.W_OK);
    checks.push({ ok: true, text: en.cli.doctorHome(store.home, (await store.listSites()).length) });
  } catch (err) {
    checks.push({ ok: false, text: en.cli.doctorHomeNotWritable(store.home, (err as Error).message) });
  }

  const browser = chromium.executablePath();
  checks.push(existsSync(browser) ? { ok: true, text: en.cli.doctorChromium(browser) } : { ok: false, text: en.cli.doctorChromiumMissing });

  const canvasDir = defaultCanvasDir();
  checks.push(
    existsSync(join(canvasDir, 'index.html')) ? { ok: true, text: en.cli.doctorCanvas(canvasDir) } : { ok: false, text: en.cli.doctorCanvasMissing(canvasDir) },
  );
  return checks;
}
