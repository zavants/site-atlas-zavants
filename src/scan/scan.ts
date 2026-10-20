import { mkdir } from 'node:fs/promises';
import { en } from '../i18n/en.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import picomatch from 'picomatch';
import robotsParserModule from 'robots-parser';
import sharp from 'sharp';
import type { ElementHandle, Page as PwPage } from 'playwright';
import type { Block, Page, Scan } from '../schema/scan.js';
import { deriveSiteId, pagePath, splitEnvironment } from '../store/paths.js';
import { blockKeys, blockName, fingerprint, inferKind } from './blocks.js';
import { openBrowser, preparePage } from './browser.js';
import { inScope, isLocalHost, normalizeUrl } from './crawl.js';
import { extractBlocks } from './extract.js';
import { mapLimit } from './limit.js';
import { computeIssues } from './issues.js';

export interface ScanOptions {
  site?: string;
  maxPages?: number;
  include?: string[];
  exclude?: string[];
  shotsDir: (scanId: string) => string;
  onProgress?: (msg: string) => void;
}

type Robots = { isAllowed(url: string, ua?: string): boolean | undefined };
const robotsParser = robotsParserModule as unknown as (url: string, contents: string) => Robots;

const SHOT_WIDTH = 480;
const SHOT_MAX_HEIGHT = 1200;
const MAX_LINK_CHECKS = 200;
const LINK_CHECK_CONCURRENCY = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function captureShot(page: PwPage, handle: ElementHandle | null, file: string): Promise<boolean> {
  if (!handle) return false;
  try {
    const box = await handle.boundingBox();
    if (!box || box.width < 1 || box.height < 1) return false;
    const scrollY = await page.evaluate('window.scrollY');
    const sourceHeight = Math.min(box.height, (SHOT_MAX_HEIGHT * box.width) / SHOT_WIDTH);
    const png = await page.screenshot({
      type: 'png',
      fullPage: true,
      clip: { x: box.x, y: box.y + Number(scrollY), width: box.width, height: sourceHeight },
      timeout: 10_000,
    });
    await sharp(png).resize({ width: SHOT_WIDTH }).webp({ quality: 70 }).toFile(file);
    return true;
  } catch {
    return false;
  }
}

async function checkStatus(url: string): Promise<number> {
  const attempt = async (method: string) => (await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(10_000) })).status;
  try {
    const head = await attempt('HEAD');
    return head === 405 ? await attempt('GET') : head;
  } catch {
    return 0;
  }
}

export async function scanSite(url: string, opts: ScanOptions): Promise<Scan> {
  const startedAt = new Date().toISOString();
  const scanId = startedAt.replace(/:/g, '-');
  const { origin, basePath } = splitEnvironment(url);
  const env = { origin, basePath };
  const options: NonNullable<Scan['options']> = { startUrl: url };
  if (opts.maxPages !== undefined) options.maxPages = opts.maxPages;
  if (opts.include?.length) options.include = opts.include;
  if (opts.exclude?.length) options.exclude = opts.exclude;
  const site = opts.site ?? deriveSiteId(url);
  const maxPages = opts.maxPages ?? 30;
  const include = opts.include?.length ? picomatch(opts.include) : null;
  const exclude = opts.exclude?.length ? picomatch(opts.exclude) : null;
  const local = isLocalHost(new URL(url).hostname);
  const shotsDir = opts.shotsDir(scanId);
  await mkdir(shotsDir, { recursive: true });

  const loadRobots = async (): Promise<Robots | null> => {
    if (local) return null;
    const robotsUrl = `${env.origin}/robots.txt`;
    try {
      const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(10_000) });
      return res.ok ? robotsParser(robotsUrl, await res.text()) : null;
    } catch {
      return null;
    }
  };
  let robots = await loadRobots();

  const pathOf = (u: string) => (inScope(u, env) ? pagePath(new URL(u).pathname, env.basePath) : null);
  const allowed = (u: string) => {
    const p = pathOf(u);
    if (p === null) return false;
    if (include && !include(p)) return false;
    if (exclude && exclude(p)) return false;
    return robots?.isAllowed(u, 'SiteAtlas') !== false;
  };

  const start = normalizeUrl(url, url)!;
  const queue = [start];
  /** Rutas ya encoladas o visitadas: dos URLs con la misma ruta de página son la misma página. */
  const seenPaths = new Set([pathOf(start)!]);
  const missing = new Set<string>();
  const pages: Page[] = [];
  const linkStatus = new Map<string, number>();
  const idsByPath = new Map<string, Set<string>>();
  const pageInfo = new Map<string, { h1Count: number; duplicateIds: string[] }>();
  const internalLinks = new Set<string>();

  const browser = await openBrowser();
  try {
    while (queue.length && pages.length < maxPages) {
      const current = queue.shift()!;
      let path = pathOf(current)!;
      const isStart = pages.length === 0 && current === start;
      opts.onProgress?.(en.scan.scanning(path));
      if (pages.length > 0 && !local) await sleep(1000);

      let prepared: Awaited<ReturnType<typeof preparePage>>;
      try {
        prepared = await preparePage(browser, current);
      } catch (err) {
        linkStatus.set(current, 0);
        pages.push({ path, url: current, title: '', status: 0, error: (err as Error).message.split('\n')[0] ?? 'Error', blocks: [] });
        continue;
      }
      const { page, status } = prepared;
      try {
        linkStatus.set(current, status);
        if (status === 404 || status === 410) {
          missing.add(path);
          continue;
        }
        const finalUrl = normalizeUrl(page.url(), page.url());
        if (isStart && finalUrl && status < 400 && !inScope(finalUrl, env)) {
          // La URL inicial redirige (http→https, dominio→www…): el sitio es el destino.
          const moved = splitEnvironment(page.url());
          env.origin = moved.origin;
          env.basePath = moved.basePath;
          robots = await loadRobots();
        }
        if (finalUrl && inScope(finalUrl, env)) {
          const finalPath = pathOf(finalUrl)!;
          if (finalPath !== path) {
            if (pages.some((p) => p.path === finalPath)) continue;
            seenPaths.add(finalPath);
            path = finalPath;
          }
        }
        if (status >= 400 || !finalUrl || !inScope(finalUrl, env)) {
          const error = status >= 400 ? `HTTP ${status}` : en.scan.redirectsOutside(page.url());
          pages.push({ path, url: current, title: '', status, error, blocks: [] });
          continue;
        }

        const { raws, handles, pageInfo: info } = await extractBlocks(page);
        const names = raws.map((r, i) => blockName(r, i + 1));
        const keys = blockKeys(path, raws.map((r, i) => ({ name: names[i]!, anchor: r.anchor })));
        const blocks: Block[] = [];
        for (const [i, raw] of raws.entries()) {
          const key = keys[i]!;
          const fileName = `${createHash('sha1').update(key).digest('hex')}.webp`;
          const shot = (await captureShot(page, handles[i] ?? null, join(shotsDir, fileName))) ? fileName : null;
          blocks.push({
            key,
            name: names[i]!,
            heading: raw.heading,
            anchor: raw.anchor,
            tag: raw.tag,
            order: i,
            height: raw.height,
            kind: inferKind(raw),
            global: false,
            fingerprint: fingerprint(raw),
            textExcerpt: raw.text.slice(0, 200),
            components: raw.components,
            shot,
          });
        }
        pages.push({ path, url: current, title: info.title, status, error: null, blocks });
        idsByPath.set(path, new Set(info.ids));
        pageInfo.set(path, { h1Count: info.h1Count, duplicateIds: info.duplicateIds });

        const hrefs = (await page.evaluate(`[...document.querySelectorAll('a[href]')].map((a) => a.href)`)) as string[];
        for (const href of hrefs) {
          const n = normalizeUrl(href, current);
          if (!n || new URL(n).origin !== env.origin) continue;
          internalLinks.add(n);
          const p = pathOf(n);
          if (p !== null && !seenPaths.has(p) && allowed(n)) {
            seenPaths.add(p);
            queue.push(n);
          }
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const unchecked = [...internalLinks].filter((l) => !linkStatus.has(l)).slice(0, MAX_LINK_CHECKS);
  const statuses = await mapLimit(unchecked, LINK_CHECK_CONCURRENCY, checkStatus);
  unchecked.forEach((link, i) => {
    linkStatus.set(link, statuses[i]!);
    const p = pathOf(link);
    if (p !== null && (statuses[i] === 404 || statuses[i] === 410)) missing.add(p);
  });

  const counts = new Map<string, number>();
  for (const p of pages) for (const fp of new Set(p.blocks.map((b) => b.fingerprint))) counts.set(fp, (counts.get(fp) ?? 0) + 1);
  for (const p of pages) for (const b of p.blocks) b.global = (counts.get(b.fingerprint) ?? 0) >= 2;

  const issues = computeIssues(pages, { linkStatus, idsByPath, pageInfo, pathOf });
  return {
    schemaVersion: 1,
    scanId,
    site,
    environment: env,
    startedAt,
    finishedAt: new Date().toISOString(),
    pages,
    missingPages: [...missing].filter((p) => !pages.some((x) => x.path === p)).sort(),
    options,
    issues,
  };
}

