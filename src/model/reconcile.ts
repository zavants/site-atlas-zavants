import type { Orphan, Overlay } from '../schema/overlay.js';
import type { Block, Scan } from '../schema/scan.js';
import { similarity } from '../scan/blocks.js';
import { renameKey } from './ops.js';

const MATCH_SIMILARITY = 0.8;
const SUGGEST_SIMILARITY = 0.5;

const pathOfKey = (key: string) => key.split(/[#~]/)[0] || '/';

function referencedKeys(o: Overlay): Set<string> {
  return new Set([
    ...Object.keys(o.blockTags),
    ...Object.keys(o.kindOverrides),
    ...Object.values(o.plannedOrder).flat(),
    ...o.plannedDeletions,
  ]);
}

function bestBySimilarity(text: string, candidates: Block[]): { block: Block; score: number } | null {
  let best: { block: Block; score: number } | null = null;
  for (const block of candidates) {
    const score = similarity(text, block.textExcerpt);
    if (!best || score > best.score) best = { block, score };
  }
  return best;
}

/** Ajusta la capa del usuario a un escaneo nuevo sin perder lo que el equipo organizó (§5.5, §6). */
export function reconcile(overlay: Overlay, prev: Scan | null, next: Scan): Overlay {
  const nextBlocks = new Map<string, { block: Block; page: string }>();
  for (const page of next.pages) for (const block of page.blocks) nextBlocks.set(block.key, { block, page: page.path });
  const prevBlocks = new Map<string, { block: Block; page: string }>();
  for (const page of prev?.pages ?? []) for (const block of page.blocks) prevBlocks.set(block.key, { block, page: page.path });
  const failedPages = new Set(next.pages.filter((p) => p.status >= 400 || p.status === 0 || p.error).map((p) => p.path));

  let o: Overlay = { ...overlay, orphans: overlay.orphans.filter((x) => !nextBlocks.has(x.key)) };
  const alreadyOrphan = new Set(o.orphans.map((x) => x.key));
  const owned = referencedKeys(o);
  const newOrphans: Orphan[] = [];

  for (const key of referencedKeys(o)) {
    if (nextBlocks.has(key) || alreadyOrphan.has(key)) continue;
    const before = prevBlocks.get(key);
    if (failedPages.has(before?.page ?? pathOfKey(key))) continue;

    const candidates = [...nextBlocks.values()].map((v) => v.block).filter((b) => !owned.has(b.key));
    let match: Block | undefined;
    if (before) {
      const b = before.block;
      match =
        (b.anchor ? candidates.find((c) => c.anchor === b.anchor) : undefined) ??
        candidates.find((c) => c.fingerprint === b.fingerprint);
      if (!match) {
        const best = bestBySimilarity(b.textExcerpt, candidates);
        if (best && best.score >= MATCH_SIMILARITY) match = best.block;
      }
    }
    if (match) {
      o = renameKey(o, key, match.key);
      owned.add(match.key);
      continue;
    }
    const best = before ? bestBySimilarity(before.block.textExcerpt, candidates) : null;
    newOrphans.push({
      key,
      lastSeen: { page: before?.page ?? pathOfKey(key), name: before?.block.name ?? key },
      suggestion: best && best.score >= SUGGEST_SIMILARITY ? best.block.key : null,
    });
    o = {
      ...o,
      plannedOrder: Object.fromEntries(Object.entries(o.plannedOrder).map(([p, ks]) => [p, ks.filter((k) => k !== key)])),
    };
  }

  const plannedOrder = { ...o.plannedOrder };
  const placed = new Set(Object.values(plannedOrder).flat());
  const newKeys: string[] = [];
  for (const page of next.pages) {
    const order = plannedOrder[page.path];
    if (!order || failedPages.has(page.path)) continue;
    const real = page.blocks.filter((b) => !b.global).map((b) => b.key);
    const updated = [...order];
    real.forEach((key, i) => {
      if (placed.has(key)) return;
      const neighbor = real.slice(0, i).reverse().find((k) => updated.includes(k));
      updated.splice(neighbor ? updated.indexOf(neighbor) + 1 : 0, 0, key);
      placed.add(key);
      newKeys.push(key);
    });
    plannedOrder[page.path] = updated;
  }

  return { ...o, plannedOrder, newKeys, orphans: [...o.orphans, ...newOrphans] };
}
