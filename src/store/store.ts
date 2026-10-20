import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyOverlay, OverlaySchema, type Overlay } from '../schema/overlay.js';
import { en } from '../i18n/en.js';
import { ScanSchema, type Scan } from '../schema/scan.js';
import { atlasHome, siteDir } from './paths.js';

export class StaleRevError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(en.store.staleRev(actual, expected));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 3 || (code !== 'EPERM' && code !== 'EBUSY')) throw err;
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
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const age = await stat(lockFile).then((st) => Date.now() - st.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS) {
        await unlink(lockFile).catch(() => undefined);
        continue;
      }
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
  /** Serializa escrituras de overlay dentro del proceso. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(home?: string) {
    this.home = home ?? atlasHome();
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
    const siteFile = join(this.dir(scan.site), 'site.json');
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
    const parsed = OverlaySchema.safeParse(raw);
    if (!parsed.success) throw new Error(en.store.invalidOverlay(file, parsed.error.message));
    return parsed.data;
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
