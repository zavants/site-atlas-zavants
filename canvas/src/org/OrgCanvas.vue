<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue';
import type { BlockView, Change, EffectiveLink, OverlayOp, SiteMap, Target } from '../api';
import { t } from '../strings';
import { createCamera } from './camera';
import { anchorPoint, curve, freeSpot, nearestTarget, normPath, type Candidate, type Point, type Rect } from './geometry';
import { autoLayout, blockIndex, TRASH, buildDiagrams, linksByOwner, orgContextKey, type DiagramModel, type Mode, type PieceModel } from './diagrams';
import { usePieceDrag, type DragState } from './usePieceDrag';
import Diagram, { type ZoneItem } from './Diagram.vue';
import Wires, { type WireColor, type WireModel } from './Wires.vue';

const props = defineProps<{
  map: SiteMap;
  changes: Change[];
  planned: boolean;
  view: string;
  mode: Mode;
  showAnchors: boolean;
  filterTag: string | null;
  canUndo: boolean;
  canRedo: boolean;
  live: boolean;
  /** Sends ops in order; with `history` (the default) they form one undoable step. Resolves after the map updates. */
  act: (ops: OverlayOp[], history?: boolean) => Promise<boolean>;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}>();

const cam = createCamera();
const viewport = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const ready = ref(false);
const XF = computed(() => (props.mode === 'shots' ? 1.6 : 1));

const diagrams = computed(() => buildDiagrams(props.map, { planned: props.planned, view: props.view }));
const auto = computed(() => autoLayout(props.map, diagrams.value));
const index = computed(() => blockIndex(props.map));
const ownerLinks = computed(() => linksByOwner(props.map));
const livePos = reactive<Record<string, Point>>({});
const movingId = ref<string | null>(null);
const pos = (id: string): Point => livePos[id] ?? props.map.layout[id] ?? auto.value[id] ?? { x: 40, y: 40 };

const open = reactive(new Set<string>());
const snapId = ref<string | null>(null);
const ghost = ref<{ d: string; color: 'edited' | 'added' } | null>(null);
const wires = ref<WireModel[]>([]);
/** Per drawn wire: its source piece and link, for retargeting. */
let wireSources = new Map<string, { el: HTMLElement; link: EffectiveLink; diagram: string }>();

/* ---------- coordinates (stage space, unzoomed) ---------- */
const toStage = (x: number, y: number) => cam.toStage(x, y, stage.value!);
function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const a = toStage(r.left, r.top);
  return { x: a.x, y: a.y, w: r.width / cam.s, h: r.height / cam.s };
}
const vpSize = () => ({ w: viewport.value?.clientWidth ?? 0, h: viewport.value?.clientHeight ?? 0 });
function bounds(): Rect {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  stage.value?.querySelectorAll('[data-testid="diagram"]').forEach((el) => {
    const r = rectOf(el);
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  });
  return Number.isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : { x: 0, y: 0, w: 1, h: 1 };
}
const fit = () => cam.fit(bounds(), vpSize());
const fitWidth = () => cam.fitWidth(bounds(), vpSize());
const centerView = () => cam.center(bounds(), vpSize());
/** Until the person pans or zooms, a viewport resize fits the content again. */
let touched = false;
const zoomBy = (f: number) => {
  touched = true;
  cam.setScale(cam.s * f);
};

/* ---------- lines ---------- */
let frame = 0;
function scheduleDraw() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
}

function draw() {
  const root = stage.value;
  if (!root) return;
  const pieces = [...root.querySelectorAll<HTMLElement>('[data-testid="piece"]:not(.float)')];
  const byKey = new Map<string, HTMLElement>();
  for (const el of pieces) {
    const key = el.dataset.key!;
    if (el.dataset.linkable === 'true' || !byKey.has(key)) byKey.set(key, el);
  }
  const byId = new Map([...root.querySelectorAll<HTMLElement>('[data-testid="diagram"]')].map((el) => [el.dataset.id!, el]));
  const out: WireModel[] = [];
  const sources = new Map<string, { el: HTMLElement; link: EffectiveLink; diagram: string }>();
  let lane = 0;
  for (const el of pieces) {
    if (el.dataset.source !== 'true') continue;
    const home = el.closest<HTMLElement>('[data-testid="diagram"]')!;
    const sR = rectOf(el);
    const x1 = sR.x + sR.w;
    const y1 = sR.y + 15;
    for (const link of ownerLinks.value.get(el.dataset.owner!) ?? []) {
      if (!link.target || (!props.planned && (link.added || link.edited))) continue;
      let dst: HTMLElement | undefined;
      let color: WireColor;
      let to: string;
      let row = false;
      if ('block' in link.target) {
        to = link.target.block;
        dst = byKey.get(to);
        row = true;
        color = 'section';
        if (!props.showAnchors && !link.edited && !link.added && dst?.closest('[data-testid="diagram"]') === home) continue;
      } else {
        to = link.target.page;
        dst = byId.get(to);
        const kind = dst?.dataset.kind;
        color = kind === 'missing' ? 'missing' : kind === 'external' ? 'external' : 'page';
      }
      if (!dst || dst === el) continue;
      if (link.edited) color = 'edited';
      if (link.added) color = 'added';
      const p = anchorPoint(sR, rectOf(dst), row);
      out.push({ id: link.id, from: link.owner, to, color, d: curve(x1, y1, p.x, p.y, p.side, lane++), x: p.x, y: p.y });
      sources.set(link.id, { el, link, diagram: home.dataset.id! });
    }
  }
  wireSources = sources;
  wires.value = out;
}

/* ---------- snapping lines to pieces and diagrams ---------- */
function nearest(p: Point, srcKey: string, srcDiagram: string): { id: string; el: HTMLElement; rect: Rect; piece: boolean } | null {
  const root = stage.value!;
  const cands: (Candidate & { el: HTMLElement })[] = [];
  root.querySelectorAll<HTMLElement>('[data-testid="piece"][data-linkable="true"]:not(.float)').forEach((el) => {
    if (el.dataset.key !== srcKey) cands.push({ id: `piece:${el.dataset.key}`, rect: rectOf(el), kind: 'piece', el });
  });
  root.querySelectorAll<HTMLElement>('[data-testid="diagram"][data-linkable="true"]').forEach((el) => {
    if (el.dataset.id !== srcDiagram) cands.push({ id: `diagram:${el.dataset.id}`, rect: rectOf(el), kind: 'diagram', el });
  });
  const id = nearestTarget(p, cands);
  const hit = cands.find((c) => c.id === id);
  return hit ? { id: hit.id, el: hit.el, rect: hit.rect, piece: hit.kind === 'piece' } : null;
}
const targetOf = (snap: { id: string }): Target =>
  snap.id.startsWith('piece:') ? { block: snap.id.slice('piece:'.length) } : { page: snap.id.slice('diagram:'.length) };
const sameTarget = (a: Target | null, b: Target) =>
  a !== null && ('block' in a ? 'block' in b && a.block === b.block : 'page' in b && a.page === b.page);

/** Shared by retargeting and connectors: a ghost line from the source that snaps within 70 px. */
function trackLine(e: PointerEvent, srcEl: HTMLElement, srcDiagram: string, color: 'edited' | 'added', done: (snap: Target | null, dragged: boolean) => void) {
  e.stopPropagation();
  e.preventDefault();
  window.getSelection()?.removeAllRanges();
  document.body.classList.add('dragging');
  const c0 = { x: e.clientX, y: e.clientY };
  const sR = rectOf(srcEl);
  const srcKey = srcEl.dataset.key!;
  let dragged = false;
  let snapped: ReturnType<typeof nearest> = null;
  ghost.value = { d: '', color };
  const move = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - c0.x, ev.clientY - c0.y) > 4) dragged = true;
    const p = toStage(ev.clientX, ev.clientY);
    snapped = nearest(p, srcKey, srcDiagram);
    snapId.value = snapped?.id ?? null;
    const end = snapped ? anchorPoint(sR, snapped.rect, snapped.piece) : { ...p, side: 'left' as const };
    ghost.value = { d: curve(sR.x + sR.w, sR.y + 15, end.x, end.y, end.side, 0), color };
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.classList.remove('dragging');
    snapId.value = null;
    ghost.value = null;
    done(snapped ? targetOf(snapped) : null, dragged);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** Retarget a line by its end circle; a click on a new connector's circle offers to delete it. */
function startRelink(e: PointerEvent, wire: WireModel) {
  const src = wireSources.get(wire.id);
  if (!props.planned || e.button !== 0 || !src) return;
  const { link } = src;
  trackLine(e, src.el, src.diagram, 'edited', (to, dragged) => {
    if (link.added && !dragged) return askDeleteConnector(link);
    if (!to || sameTarget(link.target, to)) return;
    if (link.added) {
      void props.act([
        { type: 'removeLink', linkId: link.id },
        { type: 'addLink', owner: link.owner, to, ...(link.text ? { label: link.text } : {}) },
      ]);
    } else {
      void props.act([{ type: 'relink', owner: link.owner, linkText: link.text, linkHref: link.href, to }]);
    }
  });
}

/** Drag from a piece's ＋ to create a new connector. */
function startConnector(e: PointerEvent, el: HTMLElement, piece: PieceModel) {
  if (!props.planned || e.button !== 0) return;
  const diagram = el.closest<HTMLElement>('[data-testid="diagram"]')!.dataset.id!;
  trackLine(e, el, diagram, 'added', (to) => {
    if (to) void props.act([{ type: 'addLink', owner: piece.owner, to }]);
  });
}

/* ---------- moving diagrams ---------- */
function startMoveNode(e: PointerEvent, d: DiagramModel) {
  if (e.button !== 0 || !props.planned) return;
  e.stopPropagation();
  e.preventDefault();
  window.getSelection()?.removeAllRanges();
  const p0 = toStage(e.clientX, e.clientY);
  const o = { ...pos(d.id) };
  let moved = false;
  movingId.value = d.id;
  document.body.classList.add('dragging');
  const move = (ev: PointerEvent) => {
    const p = toStage(ev.clientX, ev.clientY);
    livePos[d.id] = { x: Math.round(o.x + (p.x - p0.x) / XF.value), y: Math.round(o.y + p.y - p0.y) };
    moved = true;
    scheduleDraw();
  };
  const up = async (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    movingId.value = null;
    document.body.classList.remove('dragging');
    const at = livePos[d.id];
    // Dropped on Delete: a diagram there would hide behind it. Snap back; a planned page asks to be deleted.
    const onTrash = d.id !== TRASH && document.elementsFromPoint(ev.clientX, ev.clientY).some((el) => (el as HTMLElement).dataset?.id === TRASH);
    if (onTrash && d.kind === 'planned') askDeletePage(d);
    else if (moved && at && !onTrash) await props.act([{ type: 'setLayout', id: d.id, x: at.x, y: at.y }]);
    delete livePos[d.id];
    scheduleDraw();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/* ---------- dragging pieces ---------- */
const dragged = ref<PieceModel | null>(null);
const pieceDrag = usePieceDrag({ stage: () => stage.value, cam, redraw: scheduleDraw, drop });

function zoneFor(d: DiagramModel): ZoneItem[] | null {
  if (!d.zone) return null;
  const s = pieceDrag.drag.value;
  const items = d.zone.filter((p) => !s || p.key !== s.key).map((piece) => ({ piece, hole: false }));
  if (s && s.to === d.id && dragged.value) items.splice(s.index, 0, { piece: dragged.value, hole: true });
  return items;
}

/** Turns a drop into ops: move, mark for deletion, restore, or create the NOT FOUND page and move there. */
async function drop(s: DragState) {
  const to = diagrams.value.find((d) => d.id === s.to);
  const from = diagrams.value.find((d) => d.id === s.from);
  if (!to || !from) return;
  const ops: OverlayOp[] = [];
  if (to.kind === 'trash') {
    if (from.kind !== 'trash') ops.push({ type: 'markDeleted', blockKey: s.key });
  } else {
    if (from.kind === 'trash') ops.push({ type: 'restore', blockKey: s.key });
    if (to.kind === 'missing') {
      const at = pos(to.id);
      ops.push(
        { type: 'addPlannedPage', path: to.id, title: to.id },
        { type: 'setLayout', id: to.id, x: at.x, y: at.y },
        { type: 'moveBlock', blockKey: s.key, toPage: to.id, index: 0 },
      );
    } else {
      // The zone hides pieces marked for deletion: place before the next visible piece of the full order.
      const visible = (to.zone ?? []).map((p) => p.key).filter((k) => k !== s.key);
      const next = visible[s.index];
      const full = (props.map.pages.find((p) => p.path === to.id)?.blocks ?? []).map((b) => b.key).filter((k) => k !== s.key);
      const at = next === undefined ? full.length : Math.max(0, full.indexOf(next));
      ops.push({ type: 'moveBlock', blockKey: s.key, toPage: to.id, index: at });
    }
  }
  if (ops.length) await props.act(ops);
}

/* ---------- shared context for diagrams and pieces ---------- */
const openId = (diagramId: string, key: string) => `${diagramId}|${key}`;
function labelOf(target: Target | null): string {
  if (!target) return t.piece.noTarget;
  if ('page' in target) return target.page;
  const b: BlockView | undefined = index.value.get(target.block);
  return b ? `${b.name} (${placeOf(b.key)})` : target.block;
}
function placeOf(key: string): string {
  return props.map.pages.find((p) => p.blocks.some((b) => b.key === key))?.path ?? index.value.get(key)?.page ?? '';
}
provide(orgContextKey, {
  map: () => props.map,
  mode: () => props.mode,
  view: () => props.view,
  planned: () => props.planned,
  filterTag: () => props.filterTag,
  snapId,
  isOpen: (d, k) => open.has(openId(d, k)),
  toggle(d, k) {
    if (pieceDrag.suppressClick()) return;
    const id = openId(d, k);
    if (open.has(id)) open.delete(id);
    else open.add(id);
    void nextTick(scheduleDraw);
  },
  grab(e, el, diagramId, piece) {
    if (!piece.movable) return;
    pieceDrag.start(e, el, diagramId, () => {
      open.delete(openId(diagramId, piece.key));
      dragged.value = piece;
    });
  },
  plug: startConnector,
  setKind: (key, kind) => void props.act([{ type: 'setKind', blockKey: key, kind }], false),
  setTags: (key, tagIds) => void props.act([{ type: 'setBlockTags', blockKey: key, tagIds }], false),
  restore: (key) => void props.act([{ type: 'restore', blockKey: key }]),
  targetLabel: labelOf,
});

/* ---------- pan and zoom ---------- */
let pan: { x: number; y: number } | null = null;
const panning = ref(false);
function onPanDown(e: PointerEvent) {
  if (e.button !== 0 || (e.target as Element).closest('[data-testid="diagram"], .bar, .handle')) return;
  pan = { x: e.clientX - cam.x, y: e.clientY - cam.y };
  panning.value = true;
  touched = true;
  viewport.value?.setPointerCapture(e.pointerId);
}
function onPanMove(e: PointerEvent) {
  if (!pan) return;
  cam.x = e.clientX - pan.x;
  cam.y = e.clientY - pan.y;
}
function onPanUp() {
  pan = null;
  panning.value = false;
}
function onWheel(e: WheelEvent) {
  touched = true;
  e.preventDefault();
  if (!e.ctrlKey) {
    if (e.shiftKey) cam.x -= e.deltaY;
    else {
      cam.x -= e.deltaX;
      cam.y -= e.deltaY;
    }
    return;
  }
  const r = viewport.value!.getBoundingClientRect();
  cam.setScale(cam.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
}

/* ---------- dialogs ---------- */
const newPageDlg = ref<HTMLDialogElement | null>(null);
const npPath = ref('');
const npTitle = ref('');
const npError = ref('');
function openNewPage() {
  npPath.value = '';
  npTitle.value = '';
  npError.value = '';
  newPageDlg.value?.showModal();
}
async function submitNewPage() {
  const path = normPath(npPath.value);
  if (!path || path === '/') return void (npError.value = t.dialogs.pathRequired);
  if (props.map.pages.some((p) => p.path === path)) return void (npError.value = t.dialogs.pathExists);
  const title = npTitle.value.trim() || path;
  newPageDlg.value?.close();
  const r = viewport.value!.getBoundingClientRect();
  const c = toStage(r.left + r.width / 2, r.top + r.height / 2);
  const boxes = [...stage.value!.querySelectorAll('[data-testid="diagram"]')].map(rectOf);
  const spot = freeSpot(c.x - 160, c.y - 70, 320, 140, boxes);
  await props.act([
    { type: 'addPlannedPage', path, title },
    { type: 'setLayout', id: path, x: Math.round(spot.x / XF.value), y: spot.y },
  ]);
}

const delPageDlg = ref<HTMLDialogElement | null>(null);
const deleting = ref<DiagramModel | null>(null);
function askDeletePage(d: DiagramModel) {
  deleting.value = d;
  delPageDlg.value?.showModal();
}
function confirmDeletePage() {
  delPageDlg.value?.close();
  const d = deleting.value;
  deleting.value = null;
  if (d) void props.act([{ type: 'removePlannedPage', path: d.id }]);
}

const delConnDlg = ref<HTMLDialogElement | null>(null);
const deletingLink = ref<EffectiveLink | null>(null);
const ownerName = (owner: string) => props.map.components.find((c) => c.id === owner)?.name ?? index.value.get(owner)?.name ?? owner;
function askDeleteConnector(link: EffectiveLink) {
  deletingLink.value = link;
  delConnDlg.value?.showModal();
}
function confirmDeleteConnector() {
  delConnDlg.value?.close();
  const l = deletingLink.value;
  deletingLink.value = null;
  if (l) void props.act([{ type: 'removeLink', linkId: l.id }]);
}

const resetDlg = ref<HTMLDialogElement | null>(null);
function confirmReset() {
  resetDlg.value?.close();
  props.reset();
}

/* ---------- keyboard ---------- */
function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || !props.planned) return;
  if ((e.target as Element | null)?.closest?.('input, textarea, select, dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    props.undo();
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    e.preventDefault();
    props.redo();
  }
}

/* ---------- lifecycle ---------- */
const refit = () => (props.mode === 'shots' ? fitWidth() : fit());
let resize: ResizeObserver | null = null;
let refitTimer: ReturnType<typeof setTimeout> | undefined;
onMounted(async () => {
  window.addEventListener('keydown', onKey);
  stage.value?.addEventListener('load', scheduleDraw, true);
  resize = new ResizeObserver(() => {
    const { w, h } = vpSize();
    cam.setViewport(w, h);
    if (ready.value && !touched && w && h) refit();
    scheduleDraw();
  });
  resize.observe(viewport.value!);
  const { w, h } = vpSize();
  cam.setViewport(w, h);
  await nextTick();
  requestAnimationFrame(() => {
    fit();
    draw();
    ready.value = true;
  });
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  resize?.disconnect();
  cancelAnimationFrame(frame);
  clearTimeout(refitTimer);
});

watch(
  [() => props.mode, () => props.view],
  async () => {
    await nextTick();
    requestAnimationFrame(() => {
      refit();
      scheduleDraw();
      clearTimeout(refitTimer);
      // Screenshots change the diagrams' height as they load: fit again once they settled.
      if (props.mode !== 'shots') return;
      refitTimer = setTimeout(() => {
        refit();
        scheduleDraw();
      }, 400);
    });
  },
);
watch([() => props.map, () => props.view, () => props.planned, () => props.showAnchors], () => void nextTick(scheduleDraw));

const zoomLabel = computed(() => `${Math.round(cam.s * 100)}%`);
const changeCount = computed(() => props.changes.length);
</script>

<template>
  <div class="org">
  <details class="changes" data-testid="changes-panel">
    <summary>{{ t.changes.title(changeCount) }}</summary>
    <p v-if="!changes.length" class="muted">{{ t.changes.none }}</p>
    <ul v-else>
      <li v-for="c in changes" :key="c.id" :data-change="c.id">
        <span class="pill status" :class="c.status">{{ c.status === 'applied' ? `✓ ${t.changes.applied}` : t.changes.pending }}</span>
        <span class="summary">{{ c.summary }}</span>
        <span class="muted meta">
          {{ t.changes.by(c.by) }}<template v-if="c.confirmation"> · {{ t.changes.confirmedBy(c.confirmation.by) }}</template>
          <template v-if="c.observed"> · <span class="observed">● {{ t.changes.observed }}</span></template>
        </span>
      </li>
    </ul>
  </details>
  <div
    ref="viewport"
    class="viewport"
    :class="{ shots: mode === 'shots', panning }"
    data-testid="viewport"
    :data-ready="ready"
    :data-live="live"
    @pointerdown="onPanDown"
    @pointermove="onPanMove"
    @pointerup="onPanUp"
    @pointercancel="onPanUp"
    @wheel="onWheel"
  >
    <div class="bar hist" role="toolbar" :aria-label="t.history.aria">
      <button type="button" data-testid="undo" :title="t.history.undoTitle" :disabled="!canUndo || !planned" @click="undo">{{ t.history.undo }}</button>
      <button type="button" data-testid="redo" :title="t.history.redoTitle" :disabled="!canRedo || !planned" @click="redo">{{ t.history.redo }}</button>
      <button type="button" data-testid="reset" :title="t.history.resetTitle" :disabled="!planned" @click="resetDlg?.showModal()">{{ t.history.reset }}</button>
      <span class="sep" />
      <button type="button" data-testid="new-page" :title="t.history.newPageTitle" :disabled="!planned" @click="openNewPage">{{ t.history.newPage }}</button>
    </div>


    <div class="bar zoom" role="toolbar" :aria-label="t.zoom.aria">
      <button type="button" data-testid="zoom-out" :aria-label="t.zoom.out" @click="zoomBy(1 / 1.2)">−</button>
      <output data-testid="zoom-value">{{ zoomLabel }}</output>
      <button type="button" data-testid="zoom-in" :aria-label="t.zoom.in" @click="zoomBy(1.2)">+</button>
      <button type="button" data-testid="zoom-reset" @click="zoomBy(1 / cam.s)">{{ t.zoom.actual }}</button>
      <button type="button" data-testid="zoom-fit" @click="fit">{{ t.zoom.fit }}</button>
      <button type="button" data-testid="zoom-center" @click="centerView">{{ t.zoom.center }}</button>
    </div>

    <div ref="stage" class="stage" :style="{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})` }">
      <Wires :wires="wires" :ghost="ghost" :interactive="planned" @handle-down="startRelink" />
      <Diagram
        v-for="d in diagrams"
        :key="d.id"
        :diagram="d"
        :zone="zoneFor(d)"
        :x="Math.round(pos(d.id).x * XF)"
        :y="pos(d.id).y"
        :moving="movingId === d.id"
        :drop-target="pieceDrag.over.value === d.id"
        :settled="pieceDrag.drag.value?.settled ?? false"
        @title-down="(e: PointerEvent) => startMoveNode(e, d)"
        @delete-page="askDeletePage(d)"
      />
    </div>
  </div>
  </div>

  <dialog ref="newPageDlg" data-testid="new-page-dialog">
    <form class="np" @submit.prevent="submitNewPage">
      <strong>{{ t.dialogs.newPage }}</strong>
      <label>{{ t.dialogs.path }}
        <input v-model="npPath" :placeholder="t.dialogs.pathPlaceholder" autocomplete="off" @input="npError = ''" />
      </label>
      <label>{{ t.dialogs.title }}
        <input v-model="npTitle" :placeholder="t.dialogs.titlePlaceholder" autocomplete="off" />
      </label>
      <span class="error" role="alert">{{ npError }}</span>
      <div class="row">
        <button type="button" @click="newPageDlg?.close()">{{ t.dialogs.cancel }}</button>
        <button type="submit" class="primary">{{ t.dialogs.createPage }}</button>
      </div>
    </form>
  </dialog>

  <dialog ref="delPageDlg" data-testid="delete-page-dialog">
    <p>{{ deleting ? t.dialogs.deletePageMsg(deleting.title, deleting.zone?.length ?? 0) : '' }}</p>
    <div class="row">
      <button type="button" @click="delPageDlg?.close()">{{ t.dialogs.cancel }}</button>
      <button type="button" class="danger" @click="confirmDeletePage">{{ t.dialogs.deletePage }}</button>
    </div>
  </dialog>

  <dialog ref="delConnDlg" data-testid="delete-connector-dialog">
    <p>{{ deletingLink ? t.dialogs.deleteConnectorMsg(ownerName(deletingLink.owner), labelOf(deletingLink.target)) : '' }}</p>
    <div class="row">
      <button type="button" @click="delConnDlg?.close()">{{ t.dialogs.cancel }}</button>
      <button type="button" class="danger" @click="confirmDeleteConnector">{{ t.dialogs.deleteConnector }}</button>
    </div>
  </dialog>

  <dialog ref="resetDlg" data-testid="reset-dialog">
    <p>{{ t.resetConfirm }}</p>
    <p class="muted hint">{{ t.dialogs.resetHint }}</p>
    <div class="row">
      <button type="button" @click="resetDlg?.close()">{{ t.dialogs.cancel }}</button>
      <button type="button" class="danger" @click="confirmReset">{{ t.dialogs.resetAll }}</button>
    </div>
  </dialog>
</template>

<style scoped>
.viewport {
  position: relative;
  flex: 1;
  min-height: 320px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: grab;
  background-color: var(--canvas-bg);
  background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px);
  background-size: 20px 20px;
  user-select: none;
  -webkit-user-select: none;
}
.viewport.panning { cursor: grabbing; }
.stage { position: absolute; left: 0; top: 0; width: 1px; height: 1px; transform-origin: 0 0; }
.bar {
  position: absolute;
  z-index: 5;
  display: flex;
  gap: 4px;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  font-size: 12px;
  cursor: default;
}
.bar button { padding: 3px 9px; }
.bar button:disabled { opacity: 0.4; cursor: default; }
.hist { left: 12px; top: 12px; }
.sep { width: 1px; align-self: stretch; background: var(--border); margin: 0 2px; }
.zoom { right: 12px; bottom: 12px; }
.zoom output { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
.org { flex: 1; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.changes {
  max-height: 30vh;
  overflow: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: default;
  user-select: text;
  -webkit-user-select: text;
}
.changes summary { cursor: pointer; font-weight: 600; user-select: none; }
.changes ul { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.changes li { display: grid; gap: 2px; }
.status.pending { color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); justify-self: start; }
.status.applied { color: var(--line-green); border: 1px solid color-mix(in srgb, var(--line-green) 40%, transparent); justify-self: start; }
.observed { color: var(--accent); }
dialog { border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; font-size: 14px; max-width: 420px; background: var(--surface); color: var(--text); }
dialog::backdrop { background: rgba(0, 0, 0, 0.3); }
.row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.primary { background: var(--accent); border-color: var(--accent); color: var(--surface); }
.danger { background: var(--danger); border-color: var(--danger); color: var(--surface); }
.np { display: grid; gap: 10px; min-width: 320px; }
.np label { display: grid; gap: 4px; font-size: 13px; }
.np input { font: inherit; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
.error { color: var(--danger); font-size: 12px; min-height: 16px; }
.hint { font-size: 12px; }
</style>
