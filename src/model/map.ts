import type { Overlay } from '../schema/overlay.js';
import type { Block, Issue, Kind, Scan } from '../schema/scan.js';
import { pagePath } from '../store/paths.js';
import { componentOf } from './components.js';
import { effectiveLinks, externalOrigins, type EffectiveLink } from './links.js';
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
  /** Shared component this piece belongs to, or null. */
  componentId: string | null;
  links: EffectiveLink[];
};

export interface ComponentView {
  id: string;
  name: string;
  /** Pages that use the component, in scan order. */
  usedOn: string[];
  /** The component's piece as found on the first page that uses it. */
  block: BlockView;
}

/** Automatic diagram for a linked path that doesn't exist or for an external origin (spec §4). */
export interface TargetView {
  id: string;
  kind: 'missing' | 'external';
  label: string;
}

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
  components: ComponentView[];
  targets: TargetView[];
  layout: Overlay['layout'];
}

/** Missing paths (missingPages and broken-link targets) and external origins, without duplicates. */
function buildTargets(scan: Scan): TargetView[] {
  const { origin, basePath } = scan.environment;
  const missing = new Set(scan.missingPages);
  for (const issue of scan.issues) {
    if (issue.rule !== 'broken-link') continue;
    // Issue ids are `rule|page|blockKey|normalized target URL`.
    const href = issue.id.split('|').slice(3).join('|');
    try {
      const url = new URL(href);
      if (url.origin === origin) missing.add(pagePath(url.pathname, basePath));
    } catch {
      // Not a URL: an issue id from another source; nothing to add.
    }
  }
  const real = new Set(scan.pages.map((p) => p.path));
  return [
    ...[...missing].filter((p) => !real.has(p)).map((p): TargetView => ({ id: p, kind: 'missing', label: p })),
    ...[...externalOrigins(scan)].map((o): TargetView => ({ id: o, kind: 'external', label: new URL(o).host })),
  ];
}

/** The overlay's components must already be reconciled with `scan` (the service layer ensures it). */
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
    componentId: componentOf(block, overlay.components),
    links: effectiveLinks(block, scan, overlay),
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

  const components = new Map<string, ComponentView>();
  for (const page of scan.pages) {
    for (const block of page.blocks) {
      const id = componentOf(block, overlay.components);
      if (!id) continue;
      const known = components.get(id);
      if (!known) components.set(id, { id, name: overlay.components[id]!.name, usedOn: [page.path], block: view(block, page.path, false) });
      else if (!known.usedOn.includes(page.path)) known.usedOn.push(page.path);
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
    components: [...components.values()],
    targets: buildTargets(scan),
    layout: overlay.layout,
  };
}
