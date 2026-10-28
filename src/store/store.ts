import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyOverlay, migrateOverlay, type Overlay } from '../schema/overlay.js';
import { en } from '../i18n/en.js';
import { ScanSchema, type Scan } from '../schema/scan.js';
import { atlasHome, siteDir } from './paths.js';

/** Who may change the site: `own` when the agent can edit its code, `advisory` when it can only recommend. */
export type SiteMode = 'own' | 'advisory';

export interface SiteInfo {
  site: string;
  createdAt: string;
  name: string;
  mode: SiteMode | null;
}

/** The latest recommendation stored next to an atlas: a signed note, its one-line summary and the full Markdown. */
export interface Advice {
  by: string;
  at: string;
  summary: string;
  markdown: string;
}

const MODES: SiteMode[] = ['own', 'advisory'];
const SUMMARY_MAX = 200;

export class StaleRevError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(en.store.staleRev(actual, expected));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Unique per call: two writes of one file must never share a temp file, or they interleave into a corrupt result. */
let tmpSeq = 0;

async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${++tmpSeq}`;
  await writeFile(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 3 || (code !== 'EPERM' && code !== 'EBUSY')) {
        await unlink(tmp).catch(() => undefined);
        throw err;
      }
      await sleep(50);
    }
  }
}

async function readJson(file: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(en.store.cannotRead(file, (err as Error).message));
  }
}

const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 15_000;

/** Bloqueo entre procesos con un archivo `.lock` creado de forma exclusiva. */
async function withFileLock<T>(lockFile: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(lockFile, 'wx');
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}`);
      await handle.close();
      break;
    } catch (err) {
      // Windows reports EPERM/EACCES (not EEXIST) while another process's unlink of the lock is still pending.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw err;
      const age = await stat(lockFile).then((st) => Date.now() - st.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS && (await unlink(lockFile).then(() => true, () => false))) continue;
      if (Date.now() > deadline) throw new Error(en.store.locked(lockFile));
      await sleep(10 + Math.random() * 20);
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(lockFile).catch(() => undefined);
  }
}

export class SiteStore {
  readonly home: string;
  /** Serializes writes inside this process; `withFileLock` covers the other processes. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(home?: string) {
    this.home = home ?? atlasHome();
  }

  /** Queues a write behind the ones already running here, so none of them sees another one half-done. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  dir(site: string): string {
    return siteDir(site, this.home);
  }

  overlayFile(site: string): string {
    return join(this.dir(site), 'overlay.json');
  }

  scansDir(site: string): string {
    return join(this.dir(site), 'scans');
  }

  shotsDir(site: string, scanId: string): string {
    return join(this.dir(site), 'shots', scanId);
  }

  shotPath(site: string, scanId: string, key: string): string {
    return join(this.shotsDir(site, scanId), `${createHash('sha1').update(key).digest('hex')}.webp`);
  }

  async listSites(): Promise<{ site: string; lastScan: string | null }[]> {
    let names: string[];
    try {
      names = await readdir(join(this.home, 'sites'));
    } catch {
      return [];
    }
    const out = [];
    for (const site of names.sort()) out.push({ site, lastScan: (await this.scanIds(site)).at(-1) ?? null });
    return out;
  }

  private siteFile(site: string): string {
    return join(this.dir(site), 'site.json');
  }

  private adviceFile(site: string): string {
    return join(this.dir(site), 'advice.json');
  }

  private adviceMarkdownFile(site: string): string {
    return join(this.dir(site), 'advice.md');
  }

  /** site.json: the id, when the site was first scanned, the display name the user gave it and the mode, if any. */
  async readSiteInfo(site: string): Promise<SiteInfo> {
    const raw = (await readJson(this.siteFile(site))) as Partial<SiteInfo> | undefined;
    const mode = MODES.find((m) => m === raw?.mode) ?? null;
    return { site, createdAt: raw?.createdAt ?? '', name: typeof raw?.name === 'string' ? raw.name : '', mode };
  }

  private async writeSiteInfo(info: SiteInfo): Promise<SiteInfo> {
    await mkdir(this.dir(info.site), { recursive: true });
    await writeAtomic(this.siteFile(info.site), JSON.stringify(info, null, 2));
    return info;
  }

  // Read and write are one step: two callers setting the name and the mode at once must not each
  // write back the other's missing field.
  setSiteName(site: string, name: string): Promise<SiteInfo> {
    return this.serialize(async () => this.writeSiteInfo({ ...(await this.readSiteInfo(site)), name: name.trim() }));
  }

  setSiteMode(site: string, mode: SiteMode | null): Promise<SiteInfo> {
    return this.serialize(async () => this.writeSiteInfo({ ...(await this.readSiteInfo(site)), mode }));
  }

  /** The latest advice, or null when it was never written (or only half of it survived). */
  async readAdvice(site: string): Promise<Advice | null> {
    const raw = (await readJson(this.adviceFile(site))) as Partial<Advice> | undefined;
    if (!raw || typeof raw.by !== 'string' || typeof raw.at !== 'string' || typeof raw.summary !== 'string') return null;
    let markdown: string;
    try {
      markdown = await readFile(this.adviceMarkdownFile(site), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    return { by: raw.by, at: raw.at, summary: raw.summary, markdown };
  }

  /** Stores the advice, replacing any earlier one: only the latest is kept. */
  async writeAdvice(site: string, advice: { by: string; summary: string; markdown: string }): Promise<Advice> {
    const summary = advice.summary.trim();
    if (summary.length > SUMMARY_MAX) throw new Error(en.store.summaryTooLong);
    const saved: Advice = { by: advice.by, at: new Date().toISOString(), summary, markdown: advice.markdown };
    // The two files are one advice: written apart, a second writer could slip its markdown under this
    // one's json. The markdown goes first, so the json that names it is never ahead of its own text.
    return this.serialize(async () => {
      await mkdir(this.dir(site), { recursive: true });
      await writeAtomic(this.adviceMarkdownFile(site), saved.markdown);
      await writeAtomic(this.adviceFile(site), JSON.stringify({ by: saved.by, at: saved.at, summary: saved.summary }, null, 2));
      return saved;
    });
  }

  /** Removes the site folder: scans, thumbnails and the user layer. */
  deleteSite(site: string): Promise<void> {
    return rm(this.dir(site), { recursive: true, force: true });
  }

  private async scanIds(site: string): Promise<string[]> {
    try {
      return (await readdir(this.scansDir(site)))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .sort();
    } catch {
      return [];
    }
  }

  async saveScan(scan: Scan): Promise<void> {
    await mkdir(this.scansDir(scan.site), { recursive: true });
    const siteFile = this.siteFile(scan.site);
    if ((await readJson(siteFile)) === undefined) {
      await writeAtomic(siteFile, JSON.stringify({ site: scan.site, createdAt: scan.startedAt }, null, 2));
    }
    await writeAtomic(join(this.scansDir(scan.site), `${scan.scanId}.json`), JSON.stringify(scan));
  }

  private async scanAt(site: string, fromEnd: number): Promise<Scan | null> {
    const id = (await this.scanIds(site)).at(-fromEnd);
    if (!id) return null;
    const file = join(this.scansDir(site), `${id}.json`);
    const parsed = ScanSchema.safeParse(await readJson(file));
    if (!parsed.success) throw new Error(en.store.invalidScan(file, parsed.error.message));
    return parsed.data;
  }

  latestScan(site: string): Promise<Scan | null> {
    return this.scanAt(site, 1);
  }

  previousScan(site: string): Promise<Scan | null> {
    return this.scanAt(site, 2);
  }

  async readOverlay(site: string): Promise<Overlay> {
    const file = this.overlayFile(site);
    const raw = await readJson(file);
    if (raw === undefined) return emptyOverlay();
    try {
      return migrateOverlay(raw);
    } catch (err) {
      throw new Error(en.store.invalidOverlay(file, (err as Error).message));
    }
  }

  /**
   * Lee, transforma y guarda la capa del usuario de forma atómica, también entre procesos.
   * Si se pasa `expectedRev` y no coincide con el de disco, lanza `StaleRevError`.
   */
  updateOverlay(site: string, fn: (current: Overlay) => Overlay, expectedRev?: number): Promise<Overlay> {
    const run = this.chain.then(async () => {
      await mkdir(this.dir(site), { recursive: true });
      return withFileLock(`${this.overlayFile(site)}.lock`, async () => {
        const current = await this.readOverlay(site);
        if (expectedRev !== undefined && current.rev !== expectedRev) throw new StaleRevError(expectedRev, current.rev);
        const saved: Overlay = { ...fn(current), rev: current.rev + 1 };
        await writeAtomic(this.overlayFile(site), JSON.stringify(saved, null, 2));
        return saved;
      });
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  writeOverlay(site: string, next: Overlay, expectedRev: number): Promise<Overlay> {
    return this.updateOverlay(site, () => next, expectedRev);
  }
}
