import { en } from '../i18n/en.js';
import type { Scan } from '../schema/scan.js';
import type { SiteMode, SiteStore } from '../store/store.js';
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
  return { changes, markdown: describePlan(scan, all, status), schemaVersion: 2 };
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

/** What the home page shows per atlas: where it came from, how big it is and how much of the plan is done. */
export interface SiteSummary {
  site: string;
  name: string;
  startUrl: string | null;
  origin: string | null;
  lastScan: string | null;
  pages: number;
  blocks: number;
  issues: { error: number; warn: number; info: number };
  pending: number;
  applied: number;
  mode: SiteMode | null;
  /** The latest advice without its Markdown: the card shows the summary and opens the rest on demand. */
  advice: { by: string; at: string; summary: string } | null;
}

export async function listSiteSummaries(store: SiteStore): Promise<SiteSummary[]> {
  const out: SiteSummary[] = [];
  for (const { site, lastScan } of await store.listSites()) {
    const info = await store.readSiteInfo(site);
    const stored = await store.readAdvice(site);
    const advice = stored ? { by: stored.by, at: stored.at, summary: stored.summary } : null;
    const base: SiteSummary = { site, name: info.name, startUrl: null, origin: null, lastScan, pages: 0, blocks: 0, issues: { error: 0, warn: 0, info: 0 }, pending: 0, applied: 0, mode: info.mode, advice };
    let scan: Scan | null = null;
    try {
      scan = await store.latestScan(site);
    } catch {
      // an unreadable scan still lists the site, so it can be deleted or re-scanned
    }
    if (!scan) {
      out.push(base);
      continue;
    }
    const changes = deriveChanges(scan, withComponents(await store.readOverlay(site), scan));
    const count = (level: string) => scan!.issues.filter((i) => i.level === level).length;
    out.push({
      ...base,
      startUrl: scan.options?.startUrl ?? null,
      origin: scan.environment.origin + scan.environment.basePath,
      pages: scan.pages.length,
      blocks: scan.pages.reduce((n, p) => n + p.blocks.length, 0),
      issues: { error: count('error'), warn: count('warn'), info: count('info') },
      pending: changes.filter((c) => c.status === 'pending').length,
      applied: changes.filter((c) => c.status === 'applied').length,
    });
  }
  return out;
}
