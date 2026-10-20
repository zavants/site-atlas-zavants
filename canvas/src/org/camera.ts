import { reactive } from 'vue';
import type { Rect } from './geometry.js';

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2.5;
const FIT_WIDTH_MAX = 1.2;
const FIT_PADDING = 80;
const TOP_MARGIN = 16;
const FIT_WIDTH_TOP = 56;

type Viewport = { w: number; h: number };

const clamp = (s: number, max = MAX_SCALE) => Math.min(max, Math.max(MIN_SCALE, s));

/** Reactive pan/zoom state: stage point = (screen - (x, y)) / s. */
export function createCamera() {
  let view: Viewport = { w: 0, h: 0 };

  const cam = reactive({
    s: 1,
    x: 0,
    y: 0,

    /** Remember the viewport size so `setScale` can default to zooming around its center. */
    setViewport(w: number, h: number) {
      view = { w, h };
    },

    /** Client coordinates to stage coordinates (the stage element carries the transform). */
    toStage(clientX: number, clientY: number, stageEl: Element) {
      const r = stageEl.getBoundingClientRect();
      return { x: (clientX - r.left) / cam.s, y: (clientY - r.top) / cam.s };
    },

    /** Zoom to `s` (clamped) keeping viewport point (cx, cy) fixed; defaults to the center. */
    setScale(s: number, cx: number = view.w / 2, cy: number = view.h / 2) {
      const next = clamp(s);
      cam.x = cx - (cx - cam.x) * (next / cam.s);
      cam.y = cy - (cy - cam.y) * (next / cam.s);
      cam.s = next;
    },

    /** Center `bounds` in the viewport at the current scale, keeping the top within view. */
    center(bounds: Rect, vp: Viewport) {
      cam.x = vp.w / 2 - (bounds.x + bounds.w / 2) * cam.s;
      cam.y = Math.max(
        TOP_MARGIN - bounds.y * cam.s,
        vp.h / 2 - (bounds.y + bounds.h / 2) * cam.s,
      );
    },

    /** Scale so all of `bounds` is visible, then center it. */
    fit(bounds: Rect, vp: Viewport) {
      cam.s = clamp(Math.min(vp.w / (bounds.w + FIT_PADDING), vp.h / (bounds.h + FIT_PADDING)));
      cam.center(bounds, vp);
    },

    /** Scale to the bounds' width (max 1.2) and pin the top edge near the viewport top. */
    fitWidth(bounds: Rect, vp: Viewport) {
      cam.s = clamp(vp.w / (bounds.w + FIT_PADDING), FIT_WIDTH_MAX);
      cam.x = vp.w / 2 - (bounds.x + bounds.w / 2) * cam.s;
      cam.y = FIT_WIDTH_TOP - bounds.y * cam.s;
    },
  });

  return cam;
}

export type Camera = ReturnType<typeof createCamera>;
