import { describe, expect, it } from 'vitest';
import {
  anchorPoint,
  curve,
  freeSpot,
  nearestTarget,
  normPath,
  type Rect,
} from '../canvas/src/org/geometry.js';
import { createCamera } from '../canvas/src/org/camera.js';

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe('normPath', () => {
  it('adds a leading slash and drops the trailing one', () => {
    expect(normPath('es/soluciones/ibs/')).toBe('/es/soluciones/ibs');
  });
  it('lowercases and collapses repeated slashes', () => {
    expect(normPath('/A//B')).toBe('/a/b');
  });
  it('turns whitespace into dashes and keeps the root', () => {
    expect(normPath('  Mi Pagina ')).toBe('/mi-pagina');
    expect(normPath('/')).toBe('/');
  });
});

describe('nearestTarget', () => {
  const candidates = [
    { id: 'diagram-1', rect: r(100, 100, 200, 100), kind: 'diagram' as const },
    { id: 'piece-1', rect: r(100, 300, 200, 40), kind: 'piece' as const },
  ];
  it('returns the piece within 70 px', () => {
    expect(nearestTarget({ x: 150, y: 300 + 40 + 60 }, candidates)).toBe('piece-1');
  });
  it('returns null beyond the snap distance', () => {
    expect(nearestTarget({ x: 150, y: 300 + 40 + 80 }, candidates)).toBeNull();
  });
  it('gives pieces an 8 px bias over equally distant diagrams', () => {
    const tie = [
      { id: 'd', rect: r(0, 0, 100, 100), kind: 'diagram' as const },
      { id: 'p', rect: r(0, 120, 100, 100), kind: 'piece' as const },
    ];
    // y=110 is 10 px from both rects; the piece wins by the bias.
    expect(nearestTarget({ x: 50, y: 110 }, tie)).toBe('p');
  });
  it('honors a custom snap distance', () => {
    expect(nearestTarget({ x: 150, y: 300 + 40 + 60 }, candidates, 30)).toBeNull();
  });
  it('returns null with no candidates', () => {
    expect(nearestTarget({ x: 0, y: 0 }, [])).toBeNull();
  });
});

describe('anchorPoint', () => {
  const src = r(0, 0, 100, 40);
  it('anchors on the left edge of a target to the right', () => {
    expect(anchorPoint(src, r(200, 50, 100, 40), true)).toEqual({ x: 200, y: 65, side: 'left' });
  });
  it('anchors on the right edge of a target to the left', () => {
    const p = anchorPoint(r(300, 0, 100, 40), r(0, 50, 100, 40), false);
    expect(p).toEqual({ x: 100, y: 72, side: 'right' });
  });
  it('loops when the target shares the column', () => {
    expect(anchorPoint(src, r(10, 100, 80, 40), true).side).toBe('loop');
  });
});

describe('curve', () => {
  it('draws a midpoint-controlled bezier for side links', () => {
    expect(curve(0, 0, 100, 50, 'left', 0)).toBe('M0 0 C50 0, 50 50, 100 50');
  });
  it('offsets loops by a lane-dependent bulge that clears the diagram border', () => {
    // Peak = 10 + 0.75 * (49 - 10) ≈ 39 = 10 + 24 + 50 * 0.1.
    expect(curve(10, 0, 10, 50, 'loop', 0)).toBe('M10 0 C49 0, 49 50, 10 50');
    expect(curve(10, 0, 10, 50, 'loop', 7)).toBe(curve(10, 0, 10, 50, 'loop', 0));
    expect(curve(10, 0, 10, 50, 'loop', 1)).toBe('M10 0 C62 0, 62 50, 10 50');
    // With the diagram's right border at x = 100, the loop peaks 29 px past it.
    expect(curve(10, 0, 10, 50, 'loop', 0, 100)).toBe('M10 0 C169 0, 169 50, 10 50');
  });
});

describe('freeSpot', () => {
  const overlaps = (a: Rect, b: Rect, m: number) =>
    a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

  it('returns the requested spot when free', () => {
    expect(freeSpot(10, 20, 100, 50, [])).toEqual({ x: 10, y: 20 });
  });
  it('never overlaps the given boxes (24 px margin)', () => {
    const boxes = [r(0, 0, 230, 140), r(260, 0, 230, 140), r(0, 170, 230, 140)];
    const p = freeSpot(0, 0, 230, 140, boxes);
    const placed = r(p.x, p.y, 230, 140);
    for (const b of boxes) expect(overlaps(placed, b, 24)).toBe(false);
  });
  it('falls back to the requested point when the grid is exhausted', () => {
    const wall = [r(-10_000, -10_000, 50_000, 50_000)];
    expect(freeSpot(5.4, 7.6, 10, 10, wall)).toEqual({ x: 5, y: 8 });
  });
});

describe('camera', () => {
  const vp = { w: 1000, h: 600 };
  it('starts at identity', () => {
    const cam = createCamera();
    expect([cam.s, cam.x, cam.y]).toEqual([1, 0, 0]);
  });
  it('clamps scale to [0.2, 2.5]', () => {
    const cam = createCamera();
    cam.setScale(3);
    expect(cam.s).toBe(2.5);
    cam.setScale(0.01);
    expect(cam.s).toBe(0.2);
  });
  it('keeps the focal point fixed while zooming', () => {
    const cam = createCamera();
    cam.setScale(2, 100, 100);
    expect(cam.s).toBe(2);
    expect(cam.x).toBe(-100);
    expect(cam.y).toBe(-100);
  });
  it('zooms around the viewport center by default', () => {
    const cam = createCamera();
    cam.setViewport(vp.w, vp.h);
    cam.setScale(2);
    expect(cam.x).toBe(-500);
    expect(cam.y).toBe(-300);
  });
  it('maps client coordinates to stage coordinates', () => {
    const cam = createCamera();
    cam.setScale(2, 0, 0);
    const el = { getBoundingClientRect: () => ({ left: 50, top: 20 }) } as unknown as HTMLElement;
    expect(cam.toStage(150, 120, el)).toEqual({ x: 50, y: 50 });
  });
  it('fit scales content into the viewport and centers it', () => {
    const cam = createCamera();
    cam.fit(r(0, 0, 920, 520), vp);
    expect(cam.s).toBe(1);
    expect(cam.x).toBe(40);
    expect(cam.y).toBe(40);
  });
  it('fit never exceeds the scale limits', () => {
    const cam = createCamera();
    cam.fit(r(0, 0, 10, 10), vp);
    expect(cam.s).toBe(2.5);
    cam.fit(r(0, 0, 100_000, 100_000), vp);
    expect(cam.s).toBe(0.2);
  });
  it('fitWidth fits the width (max 1.2) and pins the top', () => {
    const cam = createCamera();
    cam.fitWidth(r(100, 50, 1920, 2000), vp);
    expect(cam.s).toBe(0.5);
    expect(cam.x).toBe(1000 / 2 - (100 + 960) * 0.5);
    expect(cam.y).toBe(56 - 50 * 0.5);
    cam.fitWidth(r(0, 0, 100, 100), vp);
    expect(cam.s).toBe(1.2);
  });
  it('center keeps the scale and keeps the top margin', () => {
    const cam = createCamera();
    cam.center(r(0, 0, 400, 100), vp);
    expect(cam.s).toBe(1);
    expect(cam.x).toBe(300);
    expect(cam.y).toBe(250);
    cam.center(r(0, 0, 400, 2000), vp);
    expect(cam.y).toBe(16);
  });
});
