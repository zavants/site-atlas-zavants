import { t } from './strings.js';
import type { BlockView, ComponentView, PageView, SiteMap, TargetView } from '../../src/model/map.js';
import type { EffectiveLink } from '../../src/model/links.js';
import type { Change } from '../../src/model/changes.js';
import type { OverlayOp, PlanFields } from '../../src/model/ops.js';
import type { Target } from '../../src/schema/overlay.js';
import type { SiteSummary } from '../../src/model/service.js';

export type { BlockView, Change, ComponentView, EffectiveLink, OverlayOp, PageView, PlanFields, SiteMap, SiteSummary, Target, TargetView };

export class ConflictError extends Error {
  constructor(readonly map: SiteMap) {
    super(t.conflict);
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; map?: SiteMap };
  if (res.status === 409 && body.map) throw new ConflictError(body.map);
  if (!res.ok) throw new Error(body.error ?? t.errorStatus(res.status));
  return body;
}

const enc = encodeURIComponent;

export const getSites = () => fetch('/api/sites').then((r) => json<SiteSummary[]>(r));

export interface ScanRequest {
  url: string;
  maxPages?: number;
  include?: string[];
  exclude?: string[];
}
/** Starts a scan of a new (or existing) site from its URL; progress arrives through `subscribe(site)`. */
export const startScan = (req: ScanRequest) =>
  fetch('/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) }).then((r) => json<{ started: true; site: string }>(r));
export const renameSite = (site: string, name: string) =>
  fetch(`/api/sites/${enc(site)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).then((r) => json<{ name: string }>(r));
export const deleteSite = (site: string) => fetch(`/api/sites/${enc(site)}`, { method: 'DELETE' }).then((r) => json<{ deleted: string }>(r));
export const getMap = (site: string) => fetch(`/api/sites/${enc(site)}/map`).then((r) => json<SiteMap>(r));
export const getPlan = (site: string) =>
  fetch(`/api/sites/${enc(site)}/plan`).then((r) => json<{ changes: Change[]; markdown: string; schemaVersion: 2 }>(r));

export const sendOp = (site: string, rev: number, op: OverlayOp) =>
  fetch(`/api/sites/${enc(site)}/ops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rev, op }),
  }).then((r) => json<SiteMap>(r));

export const rescan = (site: string) => fetch(`/api/sites/${enc(site)}/rescan`, { method: 'POST' }).then((r) => json<unknown>(r));

export type SiteEventType = 'ready' | 'overlay' | 'scan' | 'progress';

/** Server-sent events of one site. `ready` fires once the server is watching the site for changes. */
export function subscribe(site: string, onEvent: (type: SiteEventType, data: Record<string, unknown>) => void) {
  const source = new EventSource(`/api/sites/${enc(site)}/events`);
  for (const type of ['ready', 'overlay', 'scan', 'progress'] as const) {
    source.addEventListener(type, (e) => onEvent(type, JSON.parse((e as MessageEvent).data)));
  }
  return () => source.close();
}

export const shotUrl = (map: SiteMap, b: BlockView) => (b.shot ? `/shots/${enc(map.site)}/${enc(map.scanId)}/${enc(b.shot)}` : null);
