import { nextTick, ref } from 'vue';
import type { Camera } from './camera';

export interface DragState {
  key: string;
  from: string;
  fromIndex: number;
  /** Diagram that holds the gap, and the gap's index among that zone's other pieces. */
  to: string;
  index: number;
  /** Released: the op is on its way, the piece shows in place instead of as a gap. */
  settled: boolean;
}

const THRESHOLD = 5;
const FLIP_MS = 160;
const PIECES = '[data-testid="piece"]:not(.float)';

const idOf = (el: Element) => `${el.closest('[data-testid="diagram"]')?.getAttribute('data-id') ?? ''}|${el.getAttribute('data-key') ?? ''}`;

/**
 * Custom piece drag (spec §6, prototype `startDragPiece` + `flip`): starts after 5 px, the piece
 * floats inside the zoomed stage stuck to the grab point, a gap of the same height moves live and
 * the other pieces slide with FLIP. The drop index comes from layout positions (`offsetTop`), not
 * animated ones, and the receiving diagram is the one under the cursor (`elementFromPoint`).
 */
export function usePieceDrag(opts: {
  stage: () => HTMLElement | null;
  cam: Camera;
  redraw: () => void;
  drop: (s: DragState) => Promise<void>;
}) {
  const drag = ref<DragState | null>(null);
  const over = ref<string | null>(null);
  let suppress = false;

  const rectOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    const a = opts.cam.toStage(r.left, r.top, opts.stage()!);
    return { x: a.x, y: a.y, w: r.width / opts.cam.s, h: r.height / opts.cam.s };
  };

  /** Moves the gap with `mutate`, then slides every piece that moved from its old place (FLIP). */
  async function flip(mutate: () => void) {
    const root = opts.stage();
    if (!root) return mutate();
    const before = new Map<string, number>();
    root.querySelectorAll(PIECES).forEach((el) => before.set(idOf(el), el.getBoundingClientRect().top));
    mutate();
    await nextTick();
    root.querySelectorAll<HTMLElement>(PIECES).forEach((el) => {
      const top = before.get(idOf(el));
      if (top === undefined) return;
      const dy = (top - el.getBoundingClientRect().top) / opts.cam.s;
      if (!dy) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform ${FLIP_MS}ms ease`;
        el.style.transform = '';
      });
    });
    opts.redraw();
    setTimeout(opts.redraw, FLIP_MS + 20);
  }

  function start(e: PointerEvent, el: HTMLElement, diagramId: string, onStart: () => void) {
    if (e.button !== 0 || (e.target as Element).closest('.det, .plug')) return;
    const root = opts.stage();
    const zone = el.parentElement;
    if (!root || !zone) return;
    e.stopPropagation();
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    document.body.classList.add('dragging');
    const key = el.dataset.key!;
    const p0 = opts.cam.toStage(e.clientX, e.clientY, root);
    const r0 = rectOf(el);
    const grab = { x: p0.x - r0.x, y: p0.y - r0.y };
    const fromIndex = [...zone.querySelectorAll(':scope > [data-testid="piece"]')].indexOf(el);
    let floating: HTMLElement | null = null;

    const begin = () => {
      onStart();
      floating = el.cloneNode(true) as HTMLElement;
      floating.classList.add('float');
      floating.classList.remove('open');
      floating.querySelector('.det')?.remove();
      floating.removeAttribute('data-key');
      floating.removeAttribute('data-hole');
      floating.style.width = `${r0.w}px`;
      root.appendChild(floating);
      drag.value = { key, from: diagramId, fromIndex, to: diagramId, index: fromIndex, settled: false };
    };

    const move = (ev: PointerEvent) => {
      const p = opts.cam.toStage(ev.clientX, ev.clientY, root);
      if (!floating) {
        if (Math.hypot(p.x - p0.x, p.y - p0.y) * opts.cam.s < THRESHOLD) return;
        begin();
      }
      floating!.style.left = `${p.x - grab.x}px`;
      floating!.style.top = `${p.y - grab.y}px`;
      const state = drag.value;
      if (!state) return;
      // The diagram under the cursor (the floating piece doesn't catch the pointer).
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const diagram = under?.closest<HTMLElement>('[data-testid="diagram"]');
      const target = diagram?.dataset.droppable === 'true' ? diagram.querySelector<HTMLElement>(':scope > [data-zone]') : null;
      if (!diagram || !target) {
        over.value = null;
        return;
      }
      const id = diagram.dataset.id!;
      const pieces = [...target.querySelectorAll<HTMLElement>(':scope > [data-testid="piece"]')];
      // The gap is the dragged element itself until Vue marks it, then the element marked as the gap.
      const hole = pieces.filter((o) => o === el || o.dataset.hole === 'true');
      const others = pieces.filter((o) => !hole.includes(o));
      over.value = id !== state.from || !others.length ? id : null;
      // Layout position (offsetTop), not the animated one: the gap doesn't oscillate while pieces slide.
      const localY = p.y - rectOf(target).y + target.offsetTop;
      const next = others.findIndex((o) => localY < o.offsetTop + o.offsetHeight / 2);
      const index = next < 0 ? others.length : next;
      if (state.to === id && state.index === index) return;
      void flip(() => {
        drag.value = { ...state, to: id, index };
      });
    };

    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      over.value = null;
      if (!floating) return;
      suppress = true;
      setTimeout(() => (suppress = false), 0);
      (floating as HTMLElement).remove();
      const state = drag.value!;
      if (state.to === state.from && state.index === state.fromIndex) {
        drag.value = null;
        return;
      }
      drag.value = { ...state, settled: true };
      try {
        await opts.drop(state);
      } finally {
        drag.value = null;
        opts.redraw();
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  return { drag, over, start, suppressClick: () => suppress };
}
