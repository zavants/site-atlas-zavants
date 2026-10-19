import type { Scan } from '../schema/scan.js';
import { StaleRevError, type SiteStore } from '../store/store.js';
import { buildMap, type SiteMap } from './map.js';
import { applyOp, type OverlayOp } from './ops.js';
import { describePlan, diffPlan, type PlanDiff } from './plan.js';

export class SiteNotFoundError extends Error {
  constructor(site: string) {
    super(`El sitio "${site}" no tiene escaneos. Escanéalo primero con atlas_scan.`);
  }
}

export async function requireScan(store: SiteStore, site: string): Promise<Scan> {
  const scan = await store.latestScan(site);
  if (!scan) throw new SiteNotFoundError(site);
  return scan;
}

export async function getMap(store: SiteStore, site: string): Promise<SiteMap> {
  const scan = await requireScan(store, site);
  return buildMap(scan, await store.readOverlay(site));
}

export async function getPlan(store: SiteStore, site: string): Promise<{ diffs: PlanDiff[]; text: string }> {
  const diffs = diffPlan(await getMap(store, site));
  return { diffs, text: describePlan(diffs) };
}

/**
 * Aplica una operación a la capa del usuario.
 * Con `rev` explícito (lienzo) un rev viejo se rechaza; sin `rev` (agentes) se usa el actual y se reintenta una vez.
 */
export async function mutate(store: SiteStore, site: string, op: OverlayOp, rev?: number): Promise<SiteMap> {
  const scan = await requireScan(store, site);
  for (let attempt = 0; ; attempt++) {
    const current = await store.readOverlay(site);
    const expected = rev ?? current.rev;
    if (expected !== current.rev) throw new StaleRevError(expected, current.rev);
    try {
      const saved = await store.writeOverlay(site, applyOp(current, scan, op), expected);
      return buildMap(scan, saved);
    } catch (err) {
      if (!(err instanceof StaleRevError) || rev !== undefined || attempt >= 1) throw err;
    }
  }
}
