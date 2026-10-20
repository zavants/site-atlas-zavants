import { en } from '../i18n/en.js';
import type { Scan } from '../schema/scan.js';
import type { SiteStore } from '../store/store.js';
import { buildMap, type SiteMap } from './map.js';
import { applyOp, type OverlayOp } from './ops.js';
import { describePlan, diffPlan, type PlanDiff } from './plan.js';

export class SiteNotFoundError extends Error {
  constructor(site: string) {
    super(en.site.notScanned(site));
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
 * Aplica una operación a la capa del usuario bajo bloqueo.
 * Con `rev` explícito (lienzo) un rev viejo se rechaza; sin `rev` (agentes) se aplica sobre el estado actual.
 */
export async function mutate(store: SiteStore, site: string, op: OverlayOp, rev?: number): Promise<SiteMap> {
  const scan = await requireScan(store, site);
  const saved = await store.updateOverlay(site, (current) => applyOp(current, scan, op), rev);
  return buildMap(scan, saved);
}
