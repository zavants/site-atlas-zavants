import type { Orphan, Overlay, Target } from '../schema/overlay.js';
import type { Block, Scan } from '../schema/scan.js';
import { similarity } from '../scan/blocks.js';
import { observedLink, relinkObserved } from './changes.js';
import { assignComponents } from './components.js';
import { linkId, owner } from './links.js';
import { renameKey } from './ops.js';

const MATCH_SIMILARITY = 0.8;
const SUGGEST_SIMILARITY = 0.5;

const pathOfKey = (key: string) => key.split(/[#~]/)[0] || '/';
/** Owner part of a `linkId` (`<owner>|<href>|<text>`). */
const ownerOfLink = (id: string) => id.split('|')[0]!;
/** Text part of a `linkId`; the href is assumed to hold no `|`. */
const textOfLink = (id: string) => id.slice(ownerOfLink(id).length + 1).split('|').slice(1).join('|');
const targetBlocks = (t: Target) => ('block' in t ? [t.block] : []);

function referencedKeys(o: Overlay): Set<string> {
  const isBlockKey = (k: string) => !(k in o.components);
  return new Set([
    ...Object.keys(o.blockTags),
    ...Object.keys(o.kindOverrides),
    ...Object.values(o.plannedOrder).flat(),
    ...o.plannedDeletions,
    ...Object.keys(o.linkEdits).map(ownerOfLink).filter(isBlockKey),
    ...Object.values(o.linkEdits).flatMap(targetBlocks),
    ...o.addedLinks.flatMap((l) => [...(isBlockKey(l.from) ? [l.from] : []), ...targetBlocks(l.to)]),
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

/** Pages of `scan` that hold a block owned by `id` (a block key or a component id). */
function ownerPages(scan: Scan | null, o: Overlay, id: string): string[] {
  return (scan?.pages ?? []).filter((p) => p.blocks.some((b) => owner(b, o) === id)).map((p) => p.path);
}

/** Ajusta la capa del usuario a un escaneo nuevo sin perder lo que el equipo organizó (§5.5, §6). */
export function reconcile(overlay: Overlay, prev: Scan | null, next: Scan): Overlay {
  const nextBlocks = new Map<string, { block: Block; page: string }>();
  for (const page of next.pages) for (const block of page.blocks) nextBlocks.set(block.key, { block, page: page.path });
  const prevBlocks = new Map<string, { block: Block; page: string }>();
  for (const page of prev?.pages ?? []) for (const block of page.blocks) prevBlocks.set(block.key, { block, page: page.path });
  // Solo se decide sobre páginas visitadas con éxito o confirmadas como borradas (404/410);
  // lo que no se visitó (falló, no se descubrió, quedó fuera de maxPages) se conserva tal cual.
  const visited = new Set(next.pages.filter((p) => p.status > 0 && p.status < 400 && !p.error).map((p) => p.path));
  const decidable = new Set([...visited, ...(next.missingPages ?? [])]);
  const globalKeys = new Set([...nextBlocks.values()].filter((v) => v.block.global).map((v) => v.block.key));

  let o: Overlay = {
    ...overlay,
    components: assignComponents(overlay, next),
    orphans: overlay.orphans.filter((x) => !nextBlocks.has(x.key)),
  };
  const alreadyOrphan = new Set(o.orphans.map((x) => x.key));
  const owned = referencedKeys(o);
  const newOrphans: Orphan[] = [];

  for (const key of referencedKeys(o)) {
    if (nextBlocks.has(key) || alreadyOrphan.has(key)) continue;
    const before = prevBlocks.get(key);
    if (!decidable.has(before?.page ?? pathOfKey(key))) continue;

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

  const plannedOrder = Object.fromEntries(
    Object.entries(o.plannedOrder).map(([p, ks]) => [p, ks.filter((k) => !globalKeys.has(k))]),
  );
  const placed = new Set(Object.values(plannedOrder).flat());
  const newKeys: string[] = [];
  for (const page of next.pages) {
    const order = plannedOrder[page.path];
    if (!order || !visited.has(page.path)) continue;
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

  // Links after a re-scan (spec §10b): observed edits and connectors leave the overlay (their
  // confirmations stay as history); an edit whose link vanished becomes an orphan, like a block.
  const present = new Set<string>();
  for (const page of next.pages) {
    for (const block of page.blocks) {
      const id = owner(block, o);
      for (const l of block.components.links) present.add(linkId(id, l.href, l.text));
    }
  }
  /** Page to report a vanished link on, or null when this scan can't decide about its owner. */
  const linkPage = (ownerId: string): string | null => {
    if (!(ownerId in o.components)) {
      // A missing owner block is handled as a block orphan above.
      const at = nextBlocks.get(ownerId);
      return at && visited.has(at.page) ? at.page : null;
    }
    const now = ownerPages(next, o, ownerId).filter((p) => visited.has(p));
    return now[0] ?? ownerPages(prev, o, ownerId).find((p) => decidable.has(p)) ?? null;
  };
  const linkEdits: Overlay['linkEdits'] = {};
  const observed = new Set<string>();
  const linkOrphans: Orphan[] = [];
  for (const [id, edit] of Object.entries(o.linkEdits)) {
    const { by: _by, ...target } = edit;
    const ownerId = ownerOfLink(id);
    if (!present.has(id) && relinkObserved(next, o, id, target as Target)) {
      observed.add(id);
      continue;
    }
    linkEdits[id] = edit;
    if (present.has(id) || alreadyOrphan.has(id)) continue;
    const page = linkPage(ownerId);
    if (page !== null) linkOrphans.push({ key: id, lastSeen: { page, name: textOfLink(id) }, suggestion: null });
  }
  const addedLinks = o.addedLinks.filter((l) => !observedLink(next, o, l.from, l.to));
  const orphans = o.orphans.filter((x) => !present.has(x.key) && !observed.has(x.key));

  return { ...o, plannedOrder, newKeys, linkEdits, addedLinks, orphans: [...orphans, ...newOrphans, ...linkOrphans] };
}
