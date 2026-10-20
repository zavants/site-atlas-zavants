import { en } from '../i18n/en.js';
import type { Scan } from '../schema/scan.js';
import type { SiteStore } from '../store/store.js';
import { withComponents } from './components.js';
import { buildMap, type SiteMap } from './map.js';
import { applyOp, type OverlayOp } from './ops.js';
import { deriveChanges, type Change, type ChangeStatus } from './changes.js';
import { describePlan } from './plan.js';

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
  return buildMap(scan, withComponents(await store.readOverlay(site), scan));
}

export interface Plan {
  schemaVersion: 2;
  changes: Change[];
  markdown: string;
}

/** The plan derived from the latest scan and the user layer, optionally only the changes with one status. */
export async function getPlan(store: SiteStore, site: string, status?: ChangeStatus): Promise<Plan> {
  const scan = await requireScan(store, site);
  const all = deriveChanges(scan, withComponents(await store.readOverlay(site), scan));
  const changes = status ? all.filter((c) => c.status === status) : all;
  return { changes, markdown: describePlan(scan, changes, status), schemaVersion: 2 };
}

/**
 * Aplica una operación a la capa del usuario bajo bloqueo.
 * Con `rev` explícito (lienzo) un rev viejo se rechaza; sin `rev` (agentes) se aplica sobre el estado actual.
 */
export async function mutate(store: SiteStore, site: string, op: OverlayOp, rev?: number): Promise<SiteMap> {
  const scan = await requireScan(store, site);
  const saved = await store.updateOverlay(site, (current) => applyOp(withComponents(current, scan), scan, op), rev);
  return buildMap(scan, saved);
}
