/** Pure geometry helpers for the org-chart canvas. No DOM access. */

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type AnchorSide = 'left' | 'right' | 'loop';
export type Candidate = { id: string; rect: Rect; kind: 'piece' | 'diagram' };

/** Where an arrow lands on `dst`, as seen from `src`. `row` targets use a shorter row offset. */
export function anchorPoint(src: Rect, dst: Rect, row: boolean): Point & { side: AnchorSide } {
  const toRight = dst.x > src.x + src.w;
  const toLeft = dst.x + dst.w < src.x;
  const y = dst.y + (row ? 15 : 22);
  if (toRight) return { x: dst.x, y, side: 'left' };
  if (toLeft) return { x: dst.x + dst.w, y, side: 'right' };
  return { x: dst.x + dst.w, y, side: 'loop' };
}

/**
 * SVG path for an arrow. A loop (a link within the same diagram) bulges right, past `edge` (the
 * diagram's right border) by a margin that grows with its lane (7 lanes) and its height, so it never
 * runs along the border.
 */
export function curve(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  side: AnchorSide,
  lane: number,
  edge = Math.max(x1, x2),
): string {
  if (side === 'loop') {
    const x0 = Math.max(x1, x2);
    const reach = Math.max(edge, x0) + 24 + (lane % 7) * 10 + Math.min(Math.abs(y2 - y1) * 0.1, 40);
    // Both control points at c: the curve peaks at 3/4 of the way from x0 to c.
    const c = Math.round(x0 + (reach - x0) / 0.75);
    return `M${x1} ${y1} C${c} ${y1}, ${c} ${y2}, ${x2} ${y2}`;
  }
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

/** Closest candidate to `pt` within `snap` px (pieces get an 8 px bias), or null. */
export function nearestTarget(pt: Point, candidates: Candidate[], snap = 70): string | null {
  let best: string | null = null;
  let bestD = snap;
  for (const c of candidates) {
    const { x, y, w, h } = c.rect;
    const dx = Math.max(x - pt.x, 0, pt.x - (x + w));
    const dy = Math.max(y - pt.y, 0, pt.y - (y + h));
    let d = Math.hypot(dx, dy);
    if (c.kind === 'piece') d -= 8;
    if (d < bestD) {
      bestD = d;
      best = c.id;
    }
  }
  return best;
}

/** First free slot near (x, y): scans right, then down, keeping a 24 px margin from `boxes`. */
export function freeSpot(x: number, y: number, w: number, h: number, boxes: Rect[]): Point {
  const hits = (px: number, py: number) =>
    boxes.some(
      (b) => px < b.x + b.w + 24 && px + w + 24 > b.x && py < b.y + b.h + 24 && py + h + 24 > b.y,
    );
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 12; col++) {
      const px = Math.round(x + col * (w + 30));
      const py = Math.round(y + row * (h + 30));
      if (!hits(px, py)) return { x: px, y: py };
    }
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** Canonical page path: lowercase, dashes for spaces, one leading slash, no trailing slash. */
export function normPath(raw: string): string {
  let p = raw.trim().replace(/\s+/g, '-').toLowerCase();
  if (p && !p.startsWith('/')) p = '/' + p;
  return p.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
}
