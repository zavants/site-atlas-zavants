import { en } from './i18n/en.js';
import { reconcile } from './model/reconcile.js';
import type { Overlay } from './schema/overlay.js';
import type { Scan } from './schema/scan.js';
import { scanSite } from './scan/scan.js';
import { deriveSiteId } from './store/paths.js';
import type { SiteStore } from './store/store.js';

export interface RunScanOptions {
  site?: string;
  maxPages?: number;
  include?: string[];
  exclude?: string[];
  onProgress?: (msg: string) => void;
}

/** Escanea, guarda el escaneo y concilia la capa del usuario. */
export async function runScan(store: SiteStore, url: string, opts: RunScanOptions = {}): Promise<{ scan: Scan; overlay: Overlay }> {
  const site = opts.site ?? deriveSiteId(url);
  const scan = await scanSite(url, { ...opts, site, shotsDir: (scanId) => store.shotsDir(site, scanId) });
  if (!scan.pages.some((p) => p.status > 0 && p.status < 400 && !p.error)) {
    const first = scan.pages[0];
    const reason = first?.error ?? (scan.missingPages.length ? en.scan.pageMissing : en.scan.noResponse);
    throw new Error(en.scan.couldNotScan(url, reason));
  }
  const prev = await store.latestScan(site);
  await store.saveScan(scan);
  const overlay = await store.updateOverlay(site, (current) => reconcile(current, prev, scan));
  return { scan, overlay };
}
