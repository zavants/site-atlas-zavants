/**
 * Elementos de `to` que cambiaron de lugar respecto de `from`: los que quedan fuera de la
 * subsecuencia creciente más larga. Así, mover un bloque marca solo ese bloque.
 */
export function displaced(from: string[], to: string[]): Set<string> {
  const pos = new Map(from.map((k, i) => [k, i]));
  const items = to.filter((k) => pos.has(k));
  const seq = items.map((k) => pos.get(k)!);
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < seq[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<string>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]!) keep.add(items[i]!);
  return new Set(items.filter((k) => !keep.has(k)));
}
