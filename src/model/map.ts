import type { Overlay } from '../schema/overlay.js';
import type { Block, Issue, Kind, Scan } from '../schema/scan.js';
import { effectiveOrders, indexScan } from './ops.js';
import { displaced } from './order.js';

export type BlockView = Block & {
  /** Página real donde está el bloque en el último escaneo. */
  page: string;
  tags: string[];
  effectiveKind: Kind;
  kindOverridden: boolean;
  deleted: boolean;
  isNew: boolean;
  moved: boolean;
  issues: Issue[];
};

export interface PageView {
  path: string;
  title: string;
  planned: boolean;
  status: number | null;
  realOrder: string[];
  blocks: BlockView[];
}

export interface SiteMap {
  site: string;
  scanId: string;
  environment: { origin: string; basePath: string };
  rev: number;
  tags: Overlay['tags'];
  globals: BlockView[];
  pages: PageView[];
  orphans: Overlay['orphans'];
  issueCount: { error: number; warn: number; info: number };
}

export function buildMap(scan: Scan, overlay: Overlay): SiteMap {
  const idx = indexScan(scan);
  const orders = effectiveOrders(scan, overlay, idx);
  const deleted = new Set(overlay.plannedDeletions);
  const fresh = new Set(overlay.newKeys);

  const view = (block: Block, page: string, moved: boolean): BlockView => ({
    ...block,
    page,
    tags: overlay.blockTags[block.key] ?? [],
    effectiveKind: overlay.kindOverrides[block.key] ?? block.kind,
    kindOverridden: block.key in overlay.kindOverrides,
    deleted: deleted.has(block.key),
    isNew: fresh.has(block.key),
    moved,
    issues: scan.issues.filter((i) => i.blockKey === block.key),
  });

  const pageView = (path: string, title: string, planned: boolean, status: number | null): PageView => {
    const realOrder = idx.realOrder.get(path) ?? [];
    const keys = (orders.get(path) ?? []).filter((k) => idx.blocks.has(k));
    const shifted = displaced(realOrder, keys);
    const blocks = keys.map((k) => {
      const { block, page } = idx.blocks.get(k)!;
      const moved = page !== path || shifted.has(k);
      return view(block, page, moved);
    });
    return { path, title, planned, status, realOrder, blocks };
  };

  const seenGlobal = new Set<string>();
  const globals: BlockView[] = [];
  for (const page of scan.pages) {
    for (const block of page.blocks) {
      if (block.global && !seenGlobal.has(block.fingerprint)) {
        seenGlobal.add(block.fingerprint);
        globals.push(view(block, page.path, false));
      }
    }
  }

  const issueCount = { error: 0, warn: 0, info: 0 };
  for (const issue of scan.issues) issueCount[issue.level]++;

  return {
    site: scan.site,
    scanId: scan.scanId,
    environment: scan.environment,
    rev: overlay.rev,
    tags: overlay.tags,
    globals,
    pages: [
      ...scan.pages.map((p) => pageView(p.path, p.title, false, p.status)),
      ...overlay.plannedPages.map((p) => pageView(p.path, p.title, true, null)),
    ],
    orphans: overlay.orphans,
    issueCount,
  };
}
