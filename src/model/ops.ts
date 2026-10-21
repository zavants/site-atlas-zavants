import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { en } from '../i18n/en.js';
import { OverlaySchema, TargetSchema, type Overlay, type Target } from '../schema/overlay.js';
import { applyConfirmation } from './changes.js';
import { componentOf } from './components.js';
import { externalOrigins, linkId, missingPaths, owner as ownerOf, resolveTarget } from './links.js';
import type { Block, Kind, Scan } from '../schema/scan.js';

export type OverlayOp =
  | { type: 'createTag'; name: string; color?: string }
  | { type: 'renameTag'; tagId: string; name: string }
  | { type: 'deleteTag'; tagId: string }
  | { type: 'setBlockTags'; blockKey: string; tagIds: string[] }
  | { type: 'setKind'; blockKey: string; kind: Kind | null }
  | { type: 'renameComponent'; componentId: string; name: string }
  | { type: 'moveBlock'; blockKey: string; toPage: string; index: number; by?: string }
  | { type: 'addPlannedPage'; path: string; title: string; by?: string }
  | { type: 'markDeleted'; blockKey: string; by?: string }
  | { type: 'restore'; blockKey: string; by?: string }
  | { type: 'resolveOrphan'; orphanKey: string; action: 'assign' | 'discard'; targetKey?: string }
  | { type: 'relink'; owner: string; linkText: string; linkHref: string; to: Target; by?: string }
  | { type: 'addLink'; owner: string; to: Target; label?: string; by?: string }
  | { type: 'removeLink'; linkId: string; by?: string }
  | { type: 'unlink'; owner: string; linkText: string; linkHref: string; by?: string }
  | { type: 'removePlannedPage'; path: string; by?: string }
  | { type: 'setLayout'; id: string; x: number; y: number; by?: string }
  | { type: 'replacePlanFields'; fields: PlanFields; by?: string }
  | { type: 'confirmChange'; changeId: string; note: string; by: string }
  | { type: 'reopenChange'; changeId: string; note: string; by: string };

export type PlanFields = Pick<Overlay, 'plannedOrder' | 'plannedPages' | 'plannedDeletions' | 'layout' | 'linkEdits' | 'addedLinks' | 'removedLinks'>;

export class OpError extends Error {}

export const TAG_COLORS = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#BA7517', '#639922', '#888780'];

export interface ScanIndex {
  blocks: Map<string, { block: Block; page: string }>;
  realOrder: Map<string, string[]>;
}

export function indexScan(scan: Scan): ScanIndex {
  const blocks = new Map<string, { block: Block; page: string }>();
  const realOrder = new Map<string, string[]>();
  for (const page of scan.pages) {
    realOrder.set(page.path, page.blocks.filter((b) => !b.global).map((b) => b.key));
    for (const block of page.blocks) blocks.set(block.key, { block, page: page.path });
  }
  return { blocks, realOrder };
}

/** Orden efectivo de cada página (real y planificada). Los bloques que no figuran en ningún orden vuelven a su página real. */
export function effectiveOrders(scan: Scan, overlay: Overlay, idx = indexScan(scan)): Map<string, string[]> {
  const orders = new Map<string, string[]>();
  const notGlobal = (k: string) => !idx.blocks.get(k)?.block.global;
  for (const [path, real] of idx.realOrder) orders.set(path, (overlay.plannedOrder[path] ?? real).filter(notGlobal));
  for (const p of overlay.plannedPages) orders.set(p.path, (overlay.plannedOrder[p.path] ?? []).filter(notGlobal));
  const placed = new Set([...orders.values()].flat());
  for (const [path, real] of idx.realOrder) {
    for (const key of real) if (!placed.has(key)) orders.get(path)!.push(key);
  }
  return orders;
}

function requireBlock(idx: ScanIndex, key: string): { block: Block; page: string } {
  const found = idx.blocks.get(key);
  if (!found) throw new OpError(en.op.noBlock(key));
  return found;
}

function requireTag(overlay: Overlay, tagId: string) {
  const tag = overlay.tags.find((t) => t.id === tagId);
  if (!tag) throw new OpError(en.op.noTag(tagId));
  return tag;
}

/** Canonical planned page path, as the canvas `normPath`: lowercase, dashes for spaces, single slashes. */
function normPagePath(raw: string): string {
  return '/' + raw.trim().replace(/\s+/g, '-').toLowerCase().replace(/\/{2,}/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function sameTarget(a: Target, b: Target): boolean {
  return 'block' in a ? 'block' in b && a.block === b.block : 'page' in b && a.page === b.page;
}

function requireOwner(idx: ScanIndex, overlay: Overlay, id: string): void {
  if (!idx.blocks.has(id) && !(id in overlay.components)) throw new OpError(en.op.noBlock(id));
}

function requireTarget(idx: ScanIndex, scan: Scan, overlay: Overlay, to: Target): void {
  if ('block' in to) {
    requireBlock(idx, to.block);
    return;
  }
  const known =
    idx.realOrder.has(to.page) ||
    overlay.plannedPages.some((p) => p.path === to.page) ||
    scan.missingPages.includes(to.page) ||
    externalOrigins(scan).has(to.page);
  if (!known) throw new OpError(en.op.noPage(to.page));
}

export function renameKey(overlay: Overlay, from: string, to: string): Overlay {
  const swap = (k: string) => (k === from ? to : k);
  const blockTags = { ...overlay.blockTags };
  if (from in blockTags) {
    blockTags[to] = [...new Set([...(blockTags[to] ?? []), ...blockTags[from]!])];
    delete blockTags[from];
  }
  const kindOverrides = { ...overlay.kindOverrides };
  if (from in kindOverrides) {
    kindOverrides[to] ??= kindOverrides[from]!;
    delete kindOverrides[from];
  }
  const plannedOrder = Object.fromEntries(
    Object.entries(overlay.plannedOrder).map(([p, keys]) => [p, [...new Set(keys.map(swap))]]),
  );
  const swapTarget = <T extends Target>(t: T): T => ('block' in t && t.block === from ? { ...t, block: to } : t);
  const linkEdits: Overlay['linkEdits'] = {};
  for (const [id, edit] of Object.entries(overlay.linkEdits)) {
    const renamed = id.startsWith(`${from}|`) ? to + id.slice(from.length) : id;
    linkEdits[renamed] ??= swapTarget(edit);
  }
  const removedLinks: Overlay['removedLinks'] = {};
  for (const [id, mark] of Object.entries(overlay.removedLinks)) removedLinks[id.startsWith(`${from}|`) ? to + id.slice(from.length) : id] ??= mark;
  const layout = { ...overlay.layout };
  if (from in layout) {
    layout[to] ??= layout[from]!;
    delete layout[from];
  }
  return {
    ...overlay,
    blockTags,
    kindOverrides,
    plannedOrder,
    plannedDeletions: [...new Set(overlay.plannedDeletions.map(swap))],
    newKeys: overlay.newKeys.map(swap),
    linkEdits,
    removedLinks,
    addedLinks: overlay.addedLinks.map((l) => ({ ...l, from: swap(l.from), to: swapTarget(l.to) })),
    layout,
  };
}


export function applyOp(overlay: Overlay, scan: Scan, op: OverlayOp): Overlay {
  const idx = indexScan(scan);
  switch (op.type) {
    case 'createTag': {
      const name = op.name.trim();
      if (!name) throw new OpError(en.op.tagNeedsName);
      const color = op.color ?? TAG_COLORS[overlay.tags.length % TAG_COLORS.length]!;
      return { ...overlay, tags: [...overlay.tags, { id: randomUUID().slice(0, 8), name, color }] };
    }
    case 'renameTag': {
      requireTag(overlay, op.tagId);
      return { ...overlay, tags: overlay.tags.map((t) => (t.id === op.tagId ? { ...t, name: op.name.trim() || t.name } : t)) };
    }
    case 'deleteTag': {
      requireTag(overlay, op.tagId);
      const blockTags = Object.fromEntries(
        Object.entries(overlay.blockTags).map(([k, ids]) => [k, ids.filter((id) => id !== op.tagId)]),
      );
      return { ...overlay, tags: overlay.tags.filter((t) => t.id !== op.tagId), blockTags };
    }
    case 'setBlockTags': {
      requireBlock(idx, op.blockKey);
      op.tagIds.forEach((id) => requireTag(overlay, id));
      return { ...overlay, blockTags: { ...overlay.blockTags, [op.blockKey]: [...new Set(op.tagIds)] } };
    }
    case 'setKind': {
      requireBlock(idx, op.blockKey);
      const kindOverrides = { ...overlay.kindOverrides };
      if (op.kind === null) delete kindOverrides[op.blockKey];
      else kindOverrides[op.blockKey] = op.kind;
      return { ...overlay, kindOverrides };
    }
    case 'renameComponent': {
      const component = overlay.components[op.componentId];
      if (!component) throw new OpError(en.op.noComponent(op.componentId));
      const name = op.name.trim();
      if (!name) throw new OpError(en.op.componentNeedsName);
      return { ...overlay, components: { ...overlay.components, [op.componentId]: { ...component, name } } };
    }
    case 'moveBlock': {
      const { block } = requireBlock(idx, op.blockKey);
      const orders = effectiveOrders(scan, overlay, idx);
      if (!orders.has(op.toPage)) throw new OpError(en.op.noPage(op.toPage));
      const from = [...orders].find(([, keys]) => keys.includes(op.blockKey))?.[0];
      if (block.global) throw new OpError(en.op.globalBlock(block.name));
      const component = componentOf(block, overlay.components);
      if (component) throw new OpError(en.op.componentBlock(overlay.components[component]!.name));
      const plannedOrder = { ...overlay.plannedOrder };
      if (from) plannedOrder[from] = orders.get(from)!.filter((k) => k !== op.blockKey);
      const target = (from === op.toPage ? plannedOrder[op.toPage] : orders.get(op.toPage))!.filter((k) => k !== op.blockKey);
      const at = Math.max(0, Math.min(Math.trunc(op.index), target.length));
      target.splice(at, 0, op.blockKey);
      plannedOrder[op.toPage] = target;
      const authorKey = idx.blocks.get(op.blockKey)!.page === op.toPage ? `reorder|${op.toPage}` : `move|${op.blockKey}`;
      return { ...overlay, plannedOrder, authors: { ...overlay.authors, [authorKey]: op.by ?? 'canvas' } };
    }
    case 'addPlannedPage': {
      // A missing page keeps its exact path (links point there); others get the canvas `normPath` form.
      const raw = op.path.trim();
      const path = missingPaths(scan).has(raw) ? raw : normPagePath(raw);
      if (idx.realOrder.has(path) || overlay.plannedPages.some((p) => p.path === path)) {
        throw new OpError(en.op.pageExists(path));
      }
      return {
        ...overlay,
        plannedPages: [...overlay.plannedPages, { path, title: op.title.trim() || path }],
        authors: { ...overlay.authors, [`newPage|${path}`]: op.by ?? 'canvas' },
      };
    }
    case 'markDeleted': {
      requireBlock(idx, op.blockKey);
      return {
        ...overlay,
        plannedDeletions: [...new Set([...overlay.plannedDeletions, op.blockKey])],
        authors: { ...overlay.authors, [`delete|${op.blockKey}`]: op.by ?? 'canvas' },
      };
    }
    case 'restore': {
      requireBlock(idx, op.blockKey);
      const { [`delete|${op.blockKey}`]: _author, ...authors } = overlay.authors;
      return { ...overlay, plannedDeletions: overlay.plannedDeletions.filter((k) => k !== op.blockKey), authors };
    }
    case 'resolveOrphan': {
      const orphan = overlay.orphans.find((o) => o.key === op.orphanKey);
      if (!orphan) throw new OpError(en.op.noOrphan(op.orphanKey));
      const rest = { ...overlay, orphans: overlay.orphans.filter((o) => o.key !== op.orphanKey) };
      if (op.action === 'assign') {
        const target = op.targetKey ?? orphan.suggestion;
        if (!target) throw new OpError(en.op.orphanNeedsTarget);
        requireBlock(idx, target);
        return renameKey(rest, op.orphanKey, target);
      }
      const blockTags = { ...rest.blockTags };
      delete blockTags[op.orphanKey];
      const kindOverrides = { ...rest.kindOverrides };
      delete kindOverrides[op.orphanKey];
      // A link orphan's key is its linkId; a block orphan also takes the links it owns or receives.
      const key = op.orphanKey;
      const isKey = (t: Target) => 'block' in t && t.block === key;
      const linkEdits = Object.fromEntries(
        Object.entries(rest.linkEdits).filter(([id, edit]) => id !== key && !id.startsWith(`${key}|`) && !isKey(edit)),
      );
      return {
        ...rest,
        blockTags,
        kindOverrides,
        linkEdits,
        removedLinks: Object.fromEntries(Object.entries(rest.removedLinks).filter(([id]) => id !== key && !id.startsWith(`${key}|`))),
        addedLinks: rest.addedLinks.filter((l) => l.from !== key && !isKey(l.to)),
        plannedDeletions: rest.plannedDeletions.filter((k) => k !== op.orphanKey),
        plannedOrder: Object.fromEntries(Object.entries(rest.plannedOrder).map(([p, ks]) => [p, ks.filter((k) => k !== op.orphanKey)])),
      };
    }
    case 'unlink': {
      requireOwner(idx, overlay, op.owner);
      const text = op.linkText.trim();
      const scanned = scan.pages.some((p) =>
        p.blocks.some((b) => ownerOf(b, overlay) === op.owner && b.components.links.some((l) => l.href === op.linkHref && l.text.trim() === text)),
      );
      if (!scanned) throw new OpError(en.op.noScannedLink(text, op.linkHref, op.owner));
      const id = linkId(op.owner, op.linkHref, text);
      // A removed link has no new target: drop any relink of it.
      const { [id]: _edit, ...linkEdits } = overlay.linkEdits;
      return { ...overlay, linkEdits, removedLinks: { ...overlay.removedLinks, [id]: { by: op.by ?? 'canvas' } } };
    }
    case 'relink': {
      requireOwner(idx, overlay, op.owner);
      requireTarget(idx, scan, overlay, op.to);
      const text = op.linkText.trim();
      const scanned = scan.pages.find((p) =>
        p.blocks.some((b) => ownerOf(b, overlay) === op.owner && b.components.links.some((l) => l.href === op.linkHref && l.text.trim() === text)),
      );
      if (!scanned) throw new OpError(en.op.noScannedLink(text, op.linkHref, op.owner));
      const id = linkId(op.owner, op.linkHref, text);
      const original = resolveTarget(op.linkHref, scan, scanned.path);
      if (original && sameTarget(original, op.to)) {
        const { [id]: _edit, ...linkEdits } = overlay.linkEdits;
        return { ...overlay, linkEdits };
      }
      return { ...overlay, linkEdits: { ...overlay.linkEdits, [id]: { ...op.to, by: op.by ?? 'canvas' } } };
    }
    case 'addLink': {
      requireOwner(idx, overlay, op.owner);
      requireTarget(idx, scan, overlay, op.to);
      const link = { id: randomUUID().slice(0, 8), from: op.owner, to: op.to, ...(op.label ? { label: op.label } : {}), by: op.by ?? 'canvas' };
      return { ...overlay, addedLinks: [...overlay.addedLinks, link] };
    }
    case 'removeLink': {
      if (op.linkId in overlay.removedLinks) {
        const { [op.linkId]: _mark, ...removedLinks } = overlay.removedLinks;
        return { ...overlay, removedLinks };
      }
      if (overlay.addedLinks.some((l) => l.id === op.linkId)) {
        return { ...overlay, addedLinks: overlay.addedLinks.filter((l) => l.id !== op.linkId) };
      }
      if (op.linkId in overlay.linkEdits) {
        const linkEdits = { ...overlay.linkEdits };
        delete linkEdits[op.linkId];
        return { ...overlay, linkEdits };
      }
      throw new OpError(en.op.noLink(op.linkId));
    }
    case 'removePlannedPage': {
      // Exact match first, so pages stored before paths were normalized can still be removed.
      const path = overlay.plannedPages.some((p) => p.path === op.path) ? op.path : normPagePath(op.path);
      if (!overlay.plannedPages.some((p) => p.path === path)) throw new OpError(en.op.noPage(op.path));
      const page: Target = { page: path };
      const plannedOrder = { ...overlay.plannedOrder };
      delete plannedOrder[path];
      const layout = { ...overlay.layout };
      delete layout[path];
      const { [`newPage|${path}`]: _author, ...authors } = overlay.authors;
      return {
        ...overlay,
        authors,
        plannedPages: overlay.plannedPages.filter((p) => p.path !== path),
        plannedOrder,
        layout,
        linkEdits: Object.fromEntries(
          Object.entries(overlay.linkEdits).filter(([, { by: _by, ...t }]) => !sameTarget(t as Target, page)),
        ),
        addedLinks: overlay.addedLinks.filter((l) => !sameTarget(l.to, page) && l.from !== path),
      };
    }
    case 'setLayout': {
      if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) throw new OpError(en.op.badLayout);
      return { ...overlay, layout: { ...overlay.layout, [op.id]: { x: op.x, y: op.y } } };
    }
    case 'replacePlanFields': {
      const { plannedOrder, plannedPages, plannedDeletions, layout, linkEdits, addedLinks, removedLinks } = op.fields;
      return { ...overlay, plannedOrder, plannedPages, plannedDeletions, layout, linkEdits, addedLinks, removedLinks };
    }
    case 'confirmChange':
    case 'reopenChange':
      return applyConfirmation(overlay, scan, op);
  }
}

const by = z.string().default('canvas');
const KindOrNull = z.enum(['narrative', 'visual', 'conversion']).nullable();
/**
 * Ops the canvas may send over HTTP. `confirmChange` / `reopenChange` are left out on purpose:
 * only agents (MCP, CLI) confirm changes; the canvas only shows their status (spec §8.3).
 */
export const OverlayOpSchema: z.ZodType<OverlayOp> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createTag'), name: z.string(), color: z.string().optional() }),
  z.object({ type: z.literal('renameTag'), tagId: z.string(), name: z.string() }),
  z.object({ type: z.literal('deleteTag'), tagId: z.string() }),
  z.object({ type: z.literal('setBlockTags'), blockKey: z.string(), tagIds: z.array(z.string()) }),
  z.object({ type: z.literal('setKind'), blockKey: z.string(), kind: KindOrNull }),
  z.object({ type: z.literal('renameComponent'), componentId: z.string(), name: z.string() }),
  z.object({ type: z.literal('moveBlock'), blockKey: z.string(), toPage: z.string(), index: z.number(), by }),
  z.object({ type: z.literal('addPlannedPage'), path: z.string(), title: z.string(), by }),
  z.object({ type: z.literal('markDeleted'), blockKey: z.string(), by }),
  z.object({ type: z.literal('restore'), blockKey: z.string(), by }),
  z.object({
    type: z.literal('resolveOrphan'),
    orphanKey: z.string(),
    action: z.enum(['assign', 'discard']),
    targetKey: z.string().optional(),
  }),
  z.object({ type: z.literal('relink'), owner: z.string(), linkText: z.string(), linkHref: z.string(), to: TargetSchema, by }),
  z.object({ type: z.literal('addLink'), owner: z.string(), to: TargetSchema, label: z.string().optional(), by }),
  z.object({ type: z.literal('removeLink'), linkId: z.string(), by }),
  z.object({ type: z.literal('unlink'), owner: z.string(), linkText: z.string(), linkHref: z.string(), by }),
  z.object({ type: z.literal('removePlannedPage'), path: z.string(), by }),
  z.object({ type: z.literal('setLayout'), id: z.string(), x: z.number(), y: z.number(), by }),
  z.object({
    type: z.literal('replacePlanFields'),
    fields: OverlaySchema.pick({
      plannedOrder: true,
      plannedPages: true,
      plannedDeletions: true,
      layout: true,
      linkEdits: true,
      addedLinks: true,
      removedLinks: true,
    }),
    by,
  }),
]) as z.ZodType<OverlayOp>;
