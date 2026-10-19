import { createHash } from 'node:crypto';
import type { Components, Kind } from '../schema/scan.js';

/** Lo que la extracción en el navegador devuelve por cada bloque. */
export interface RawBlock {
  tag: string;
  atlasName: string | null;
  ariaLabel: string | null;
  kicker: string | null;
  heading: string | null;
  anchor: string | null;
  height: number;
  text: string;
  childTags: string[];
  hasForm: boolean;
  /** Área del canvas/video más grande ÷ área del bloque. */
  visualRatio: number;
  components: Components;
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

const present = (s: string | null): s is string => s !== null && s.trim() !== '';

export function blockName(raw: RawBlock, ordinal: number): string {
  const candidate = [raw.atlasName, raw.ariaLabel, raw.kicker, raw.heading, raw.anchor].find(present);
  if (candidate) return candidate.replace(/\s+/g, ' ').trim();
  if (raw.tag === 'header') return 'Header';
  if (raw.tag === 'footer') return 'Footer';
  return `${raw.tag} ${ordinal}`;
}

export function inferKind(raw: RawBlock): Kind {
  if (raw.hasForm) return 'conversion';
  if (raw.visualRatio >= 0.3) return 'visual';
  return 'narrativa';
}

export function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function blockKeys(path: string, raws: { name: string; anchor: string | null }[]): string[] {
  const seen = new Map<string, number>();
  return raws.map(({ name, anchor }) => {
    if (anchor) return `${path}#${anchor}`;
    const base = slug(name) || 'bloque';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${path}~${n === 1 ? base : `${base}-${n}`}`;
  });
}

export function fingerprint(raw: Pick<RawBlock, 'heading' | 'text' | 'childTags'>): string {
  const source = `${normalize(raw.heading ?? '')}|${normalize(raw.text).slice(0, 200)}|${raw.childTags.join(',')}`;
  return createHash('sha1').update(source).digest('hex').slice(0, 12);
}

function bigrams(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const g = text.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Coeficiente de Dice sobre bigramas de caracteres. */
export function similarity(a: string, b: string): number {
  const ga = bigrams(normalize(a));
  const gb = bigrams(normalize(b));
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  if (total === 0) return 0;
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / total;
}
