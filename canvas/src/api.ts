import type { BlockView, SiteMap } from '../../src/model/map.js';
import type { OverlayOp } from '../../src/model/ops.js';

export type { BlockView, SiteMap, OverlayOp };

export class ConflictError extends Error {
  constructor(readonly map: SiteMap) {
    super('Alguien más cambió el mapa; se recargó.');
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; map?: SiteMap };
  if (res.status === 409 && body.map) throw new ConflictError(body.map);
  if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
  return body;
}

const enc = encodeURIComponent;

export const getSites = () => fetch('/api/sites').then((r) => json<{ site: string; lastScan: string | null }[]>(r));
export const getMap = (site: string) => fetch(`/api/sites/${enc(site)}/map`).then((r) => json<SiteMap>(r));

export const sendOp = (site: string, rev: number, op: OverlayOp) =>
  fetch(`/api/sites/${enc(site)}/ops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rev, op }),
  }).then((r) => json<SiteMap>(r));

export const rescan = (site: string) => fetch(`/api/sites/${enc(site)}/rescan`, { method: 'POST' }).then((r) => json<unknown>(r));

export function subscribe(site: string, onEvent: (type: 'overlay' | 'scan' | 'progress', data: Record<string, unknown>) => void) {
  const source = new EventSource(`/api/sites/${enc(site)}/events`);
  for (const type of ['overlay', 'scan', 'progress'] as const) {
    source.addEventListener(type, (e) => onEvent(type, JSON.parse((e as MessageEvent).data)));
  }
  return () => source.close();
}

export const shotUrl = (map: SiteMap, b: BlockView) => (b.shot ? `/shots/${enc(map.site)}/${enc(map.scanId)}/${enc(b.shot)}` : null);
