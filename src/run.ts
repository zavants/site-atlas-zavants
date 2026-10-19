import { reconcile } from './model/reconcile.js';
import type { Overlay } from './schema/overlay.js';
import type { Scan } from './schema/scan.js';
import { scanSite } from './scan/scan.js';
import { deriveSiteId } from './store/paths.js';
import { StaleRevError, type SiteStore } from './store/store.js';

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
  const prev = await store.latestScan(site);
  await store.saveScan(scan);
  for (let attempt = 0; ; attempt++) {
    const current = await store.readOverlay(site);
    try {
      const overlay = await store.writeOverlay(site, reconcile(current, prev, scan), current.rev);
      return { scan, overlay };
    } catch (err) {
      if (!(err instanceof StaleRevError) || attempt >= 1) throw err;
    }
  }
}
