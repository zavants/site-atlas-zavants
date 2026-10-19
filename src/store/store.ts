import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyOverlay, OverlaySchema, type Overlay } from '../schema/overlay.js';
import { ScanSchema, type Scan } from '../schema/scan.js';
import { atlasHome, siteDir } from './paths.js';

export class StaleRevError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`La capa del usuario cambió (rev ${actual}, se esperaba ${expected}).`);
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
    throw new Error(`No se pudo leer ${file}: ${(err as Error).message}`);
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
    if (!parsed.success) throw new Error(`Escaneo inválido en ${file}: ${parsed.error.message}`);
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
    if (!parsed.success) throw new Error(`Capa del usuario inválida en ${file}: ${parsed.error.message}`);
    return parsed.data;
  }

  writeOverlay(site: string, next: Overlay, expectedRev: number): Promise<Overlay> {
    const run = this.chain.then(async () => {
      const current = await this.readOverlay(site);
      if (current.rev !== expectedRev) throw new StaleRevError(expectedRev, current.rev);
      const saved: Overlay = { ...next, rev: current.rev + 1 };
      await mkdir(this.dir(site), { recursive: true });
      await writeAtomic(this.overlayFile(site), JSON.stringify(saved, null, 2));
      return saved;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
