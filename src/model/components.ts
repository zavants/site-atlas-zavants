import { similarity } from '../scan/blocks.js';
import type { Overlay } from '../schema/overlay.js';
import type { Block, Scan } from '../schema/scan.js';

type Components = Overlay['components'];

const MATCH = 0.8;

function kindWord(block: Block): string {
  if (block.tag === 'header') return 'Header';
  if (block.tag === 'footer') return 'Footer';
  return 'Component';
}

function exactId(block: Block, components: Components): string | null {
  return Object.entries(components).find(([, c]) => c.fingerprint === block.fingerprint)?.[0] ?? null;
}

function find(block: Block, components: Components, claimed: ReadonlySet<string> = new Set()): string | null {
  const exact = exactId(block, components);
  if (exact) return exact;
  let best: string | null = null;
  let bestScore = MATCH;
  for (const [id, c] of Object.entries(components)) {
    if (claimed.has(id)) continue;
    const score = similarity(block.textExcerpt, c.excerpt);
    if (score >= bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Reconciles shared components against a scan. Existing ids and names are kept
 * (fingerprint and text follow the latest match); new ones are named per kind. Exact fingerprints
 * are claimed first; similarity only matches an id no other fingerprint of this scan claimed, so
 * two variants in one scan stay apart.
 */
export function assignComponents(overlay: Overlay, scan: Scan): Components {
  const out: Components = { ...overlay.components };
  const blocks = new Map<string, Block>();
  for (const page of scan.pages) {
    for (const block of page.blocks) if (block.isComponent && !blocks.has(block.fingerprint)) blocks.set(block.fingerprint, block);
  }
  const claimed = new Set<string>();
  const pending: Block[] = [];
  for (const block of blocks.values()) {
    const id = exactId(block, out);
    if (!id) {
      pending.push(block);
      continue;
    }
    claimed.add(id);
    out[id] = { ...out[id]!, excerpt: block.textExcerpt };
  }
  for (const block of pending) {
    const id = find(block, out, claimed);
    if (id) {
      claimed.add(id);
      out[id] = { ...out[id]!, fingerprint: block.fingerprint, excerpt: block.textExcerpt };
      continue;
    }
    const word = kindWord(block);
    const used = Object.values(out).map((c) => new RegExp(`^${word} ([0-9]+)$`).exec(c.name)?.[1]);
    const next = Math.max(0, ...used.map((n) => Number(n ?? 0))) + 1;
    out[`c:${block.fingerprint}`] = { fingerprint: block.fingerprint, name: `${word} ${next}`, excerpt: block.textExcerpt };
    claimed.add(`c:${block.fingerprint}`);
  }
  return out;
}

/**
 * The overlay with its components reconciled against `scan`. Re-scans already do this; the service
 * layer applies it on read and before each op so overlays not reconciled yet (fresh or migrated
 * from v1) agree with the map on component owners.
 */
export function withComponents(overlay: Overlay, scan: Scan): Overlay {
  return { ...overlay, components: assignComponents(overlay, scan) };
}

/** Component id a block belongs to, or null. */
export function componentOf(block: Block, components: Components): string | null {
  return block.isComponent ? find(block, components) : null;
}
