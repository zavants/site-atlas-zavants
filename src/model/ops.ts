import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Overlay } from '../schema/overlay.js';
import type { Block, Kind, Scan } from '../schema/scan.js';

export type OverlayOp =
  | { type: 'createTag'; name: string; color?: string }
  | { type: 'renameTag'; tagId: string; name: string }
  | { type: 'deleteTag'; tagId: string }
  | { type: 'setBlockTags'; blockKey: string; tagIds: string[] }
  | { type: 'setKind'; blockKey: string; kind: Kind | null }
  | { type: 'moveBlock'; blockKey: string; toPage: string; index: number }
  | { type: 'addPlannedPage'; path: string; title: string }
  | { type: 'markDeleted'; blockKey: string }
  | { type: 'restore'; blockKey: string }
  | { type: 'resolveOrphan'; orphanKey: string; action: 'assign' | 'discard'; targetKey?: string };

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
  if (!found) throw new OpError(`No existe el bloque ${key} en el último escaneo.`);
  return found;
}

function requireTag(overlay: Overlay, tagId: string) {
  const tag = overlay.tags.find((t) => t.id === tagId);
  if (!tag) throw new OpError(`No existe la etiqueta ${tagId}.`);
  return tag;
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
  return {
    ...overlay,
    blockTags,
    kindOverrides,
    plannedOrder,
    plannedDeletions: [...new Set(overlay.plannedDeletions.map(swap))],
    newKeys: overlay.newKeys.map(swap),
  };
}


export function applyOp(overlay: Overlay, scan: Scan, op: OverlayOp): Overlay {
  const idx = indexScan(scan);
  switch (op.type) {
    case 'createTag': {
      const name = op.name.trim();
      if (!name) throw new OpError('La etiqueta necesita un nombre.');
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
    case 'moveBlock': {
      const { block } = requireBlock(idx, op.blockKey);
      const orders = effectiveOrders(scan, overlay, idx);
      if (!orders.has(op.toPage)) throw new OpError(`No existe la página ${op.toPage}.`);
      const from = [...orders].find(([, keys]) => keys.includes(op.blockKey))?.[0];
      if (block.global) throw new OpError(`"${block.name}" es un bloque global: se comparte entre páginas y no se mueve.`);
      const plannedOrder = { ...overlay.plannedOrder };
      if (from) plannedOrder[from] = orders.get(from)!.filter((k) => k !== op.blockKey);
      const target = (from === op.toPage ? plannedOrder[op.toPage] : orders.get(op.toPage))!.filter((k) => k !== op.blockKey);
      const at = Math.max(0, Math.min(Math.trunc(op.index), target.length));
      target.splice(at, 0, op.blockKey);
      plannedOrder[op.toPage] = target;
      return { ...overlay, plannedOrder };
    }
    case 'addPlannedPage': {
      const path = '/' + op.path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
      if (idx.realOrder.has(path) || overlay.plannedPages.some((p) => p.path === path)) {
        throw new OpError(`Ya existe la página ${path}.`);
      }
      return { ...overlay, plannedPages: [...overlay.plannedPages, { path, title: op.title.trim() || path }] };
    }
    case 'markDeleted': {
      requireBlock(idx, op.blockKey);
      return { ...overlay, plannedDeletions: [...new Set([...overlay.plannedDeletions, op.blockKey])] };
    }
    case 'restore': {
      requireBlock(idx, op.blockKey);
      return { ...overlay, plannedDeletions: overlay.plannedDeletions.filter((k) => k !== op.blockKey) };
    }
    case 'resolveOrphan': {
      const orphan = overlay.orphans.find((o) => o.key === op.orphanKey);
      if (!orphan) throw new OpError(`No existe el huérfano ${op.orphanKey}.`);
      const rest = { ...overlay, orphans: overlay.orphans.filter((o) => o.key !== op.orphanKey) };
      if (op.action === 'assign') {
        const target = op.targetKey ?? orphan.suggestion;
        if (!target) throw new OpError('Falta el bloque al que asignar el huérfano.');
        requireBlock(idx, target);
        return renameKey(rest, op.orphanKey, target);
      }
      const blockTags = { ...rest.blockTags };
      delete blockTags[op.orphanKey];
      const kindOverrides = { ...rest.kindOverrides };
      delete kindOverrides[op.orphanKey];
      return {
        ...rest,
        blockTags,
        kindOverrides,
        plannedDeletions: rest.plannedDeletions.filter((k) => k !== op.orphanKey),
        plannedOrder: Object.fromEntries(Object.entries(rest.plannedOrder).map(([p, ks]) => [p, ks.filter((k) => k !== op.orphanKey)])),
      };
    }
  }
}

const KindOrNull = z.enum(['narrativa', 'visual', 'conversion']).nullable();
export const OverlayOpSchema: z.ZodType<OverlayOp> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createTag'), name: z.string(), color: z.string().optional() }),
  z.object({ type: z.literal('renameTag'), tagId: z.string(), name: z.string() }),
  z.object({ type: z.literal('deleteTag'), tagId: z.string() }),
  z.object({ type: z.literal('setBlockTags'), blockKey: z.string(), tagIds: z.array(z.string()) }),
  z.object({ type: z.literal('setKind'), blockKey: z.string(), kind: KindOrNull }),
  z.object({ type: z.literal('moveBlock'), blockKey: z.string(), toPage: z.string(), index: z.number() }),
  z.object({ type: z.literal('addPlannedPage'), path: z.string(), title: z.string() }),
  z.object({ type: z.literal('markDeleted'), blockKey: z.string() }),
  z.object({ type: z.literal('restore'), blockKey: z.string() }),
  z.object({
    type: z.literal('resolveOrphan'),
    orphanKey: z.string(),
    action: z.enum(['assign', 'discard']),
    targetKey: z.string().optional(),
  }),
]) as z.ZodType<OverlayOp>;
