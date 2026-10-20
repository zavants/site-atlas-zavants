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

function find(block: Block, components: Components): string | null {
  const exact = Object.entries(components).find(([, c]) => c.fingerprint === block.fingerprint);
  if (exact) return exact[0];
  let best: string | null = null;
  let bestScore = MATCH;
  for (const [id, c] of Object.entries(components)) {
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
 * (fingerprint and text follow the latest match); new ones are named per kind.
 */
export function assignComponents(overlay: Overlay, scan: Scan): Components {
  const out: Components = { ...overlay.components };
  for (const page of scan.pages) {
    for (const block of page.blocks) {
      if (!block.isComponent) continue;
      const id = find(block, out);
      if (id) {
        out[id] = { ...out[id]!, fingerprint: block.fingerprint, excerpt: block.textExcerpt };
        continue;
      }
      const word = kindWord(block);
      const used = Object.values(out).map((c) => new RegExp(`^${word} ([0-9]+)$`).exec(c.name)?.[1]);
      const next = Math.max(0, ...used.map((n) => Number(n ?? 0))) + 1;
      out[`c:${block.fingerprint}`] = { fingerprint: block.fingerprint, name: `${word} ${next}`, excerpt: block.textExcerpt };
    }
  }
  return out;
}

/** Component id a block belongs to, or null. */
export function componentOf(block: Block, components: Components): string | null {
  return block.isComponent ? find(block, components) : null;
}
