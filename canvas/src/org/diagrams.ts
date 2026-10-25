import type { InjectionKey, Ref } from 'vue';
import type { BlockView, ComponentView, EffectiveLink, SiteMap, Target } from '../api';
import { t } from '../strings';

export const TRASH = '~delete';
export const PAGES = 'pages';

export type DiagramKind = 'page' | 'planned' | 'missing' | 'external' | 'component' | 'trash';
export type Mode = 'diagram' | 'shots';

export interface PieceModel {
  key: string;
  block: BlockView;
  /** Set for shared components (shown with the COMPONENT label in page diagrams). */
  component: ComponentView | null;
  /** Owner id of the piece's links: the component id or the block key. */
  owner: string;
  /** Lines start from this piece. */
  source: boolean;
  /** The piece can be dragged to another position or diagram. */
  movable: boolean;
  /** Lines and connectors can end on this piece. */
  linkable: boolean;
  /** In a component's diagram: targeted by the component (`hit`) or not (`dim`). */
  state: '' | 'hit' | 'dim';
}

export interface DiagramModel {
  id: string;
  kind: DiagramKind;
  title: string;
  subtitle: string;
  small: boolean;
  /** Pieces can be dropped in its zone. */
  droppable: boolean;
  /** Lines and connectors can end on the diagram itself. */
  linkable: boolean;
  status: number | null;
  /** Fixed pieces above and below the drop zone (shared components of the page). */
  top: PieceModel[];
  zone: PieceModel[] | null;
  bottom: PieceModel[];
}

export interface DiagramOptions {
  planned: boolean;
  /** `pages` or a component id. */
  view: string;
}

const isBottom = (b: BlockView) => b.tag === 'footer';

/** Every piece by block key, including global blocks. */
export function blockIndex(map: SiteMap): Map<string, BlockView> {
  const out = new Map<string, BlockView>();
  for (const b of map.globals) out.set(b.key, b);
  for (const p of map.pages) for (const b of p.blocks) out.set(b.key, b);
  for (const c of map.components) if (!out.has(c.block.key)) out.set(c.block.key, c.block);
  return out;
}

/** Effective links per owner (component id or block key). */
export function linksByOwner(map: SiteMap): Map<string, EffectiveLink[]> {
  const out = new Map<string, EffectiveLink[]>();
  for (const b of blockIndex(map).values()) {
    const owner = b.componentId ?? b.key;
    if (!out.has(owner)) out.set(owner, b.links);
  }
  return out;
}

export function buildDiagrams(map: SiteMap, opts: DiagramOptions): DiagramModel[] {
  const index = blockIndex(map);
  const components = new Map(map.components.map((c) => [c.id, c]));
  const focus = opts.view === PAGES ? null : (components.get(opts.view) ?? null);
  const hits = new Set(
    (focus?.block.links ?? []).flatMap((l) => (l.target && 'block' in l.target ? [l.target.block] : [])),
  );
  const editing = opts.planned && !focus;

  const piece = (b: BlockView, over: Partial<PieceModel> = {}): PieceModel => {
    const component = b.componentId ? (components.get(b.componentId) ?? null) : null;
    return {
      key: b.key,
      block: b,
      component,
      owner: b.componentId ?? b.key,
      source: !focus && !component,
      movable: editing && !component,
      linkable: !component,
      state: focus ? (hits.has(b.key) ? 'hit' : 'dim') : '',
      ...over,
    };
  };

  const diagrams: DiagramModel[] = [];
  if (focus) {
    diagrams.push({
      id: focus.id,
      kind: 'component',
      title: focus.name,
      subtitle: t.diagram.usedOn(focus.usedOn),
      small: true,
      droppable: false,
      linkable: false,
      status: null,
      top: [piece(focus.block, { source: true, linkable: false, state: '' })],
      zone: null,
      bottom: [],
    });
  }

  const globalsOn = (path: string) =>
    map.components
      .filter((c) => c.block.global && c.usedOn.includes(path))
      .sort((a, b) => a.block.order - b.block.order)
      .map((c) => piece(c.block));

  for (const p of map.pages) {
    if (p.planned && !opts.planned) continue;
    const keys = opts.planned ? p.blocks.filter((b) => !b.deleted).map((b) => b.key) : p.realOrder;
    let zone = keys.map((k) => index.get(k)).filter((b): b is BlockView => Boolean(b)).map((b) => piece(b));
    let top: PieceModel[] = [];
    let bottom: PieceModel[] = [];
    if (focus) zone = zone.filter((x) => !x.component);
    else if (!p.planned) {
      const fixed = globalsOn(p.path);
      top = fixed.filter((x) => !isBottom(x.block));
      bottom = fixed.filter((x) => isBottom(x.block));
    }
    diagrams.push({
      id: p.path,
      kind: p.planned ? 'planned' : 'page',
      title: p.title || p.path,
      subtitle: p.title && p.title !== p.path ? p.path : '',
      small: false,
      droppable: editing,
      linkable: true,
      status: p.status,
      top,
      zone,
      bottom,
    });
  }

  // A planned page with the same path as a NOT FOUND target replaces it: the target is that page's future.
  const planned = new Set(map.pages.filter((p) => p.planned).map((p) => p.path));
  // In the plan, a target no link points to any more (all removed or relinked) goes away with them.
  const linked = new Set<string>();
  for (const p of map.pages) for (const b of p.blocks) for (const l of b.links) if (!l.removed && l.target && 'page' in l.target) linked.add(l.target.page);
  for (const target of map.targets) {
    if (target.kind === 'missing' && opts.planned && planned.has(target.id)) continue;
    if (opts.planned && !linked.has(target.id)) continue;
    diagrams.push({
      id: target.id,
      kind: target.kind,
      title: target.label,
      subtitle: '',
      small: true,
      droppable: editing && target.kind === 'missing',
      linkable: true,
      status: null,
      top: [],
      zone: target.kind === 'missing' ? [] : null,
      bottom: [],
    });
  }

  if (editing) {
    const deleted = [...index.values()].filter((b) => b.deleted).map((b) => piece(b, { linkable: false, source: false }));
    diagrams.push({
      id: TRASH,
      kind: 'trash',
      title: t.diagram.trash,
      subtitle: '',
      small: false,
      droppable: true,
      linkable: false,
      status: null,
      top: [],
      zone: deleted,
      bottom: [],
    });
  }
  return diagrams;
}

const X0 = 360;
const STEP = 420;
const ROW = 150;

/**
 * Initial positions (Diagram-view coordinates) for diagrams without a stored layout: real pages in a
 * row, targets and Delete in a column to their right, planned pages after that, a component on the left.
 * Only real pages count for the column, so adding a planned page never shifts the others.
 */
export function autoLayout(map: SiteMap, diagrams: DiagramModel[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const realCount = map.pages.filter((p) => !p.planned).length;
  const column = X0 + realCount * STEP;
  let page = 0;
  let target = 0;
  let planned = 0;
  for (const d of diagrams) {
    if (d.kind === 'page') out[d.id] = { x: X0 + page++ * STEP, y: 40 };
    else if (d.kind === 'missing' || d.kind === 'external') out[d.id] = { x: column, y: 40 + target++ * ROW };
    else if (d.kind === 'planned') out[d.id] = { x: column + 330 + planned++ * STEP, y: 40 };
    else if (d.kind === 'component') out[d.id] = { x: 40, y: 40 };
  }
  const trash = diagrams.find((d) => d.kind === 'trash');
  if (trash) out[trash.id] = { x: column, y: 40 + map.targets.length * ROW };
  return out;
}

/** What the canvas shares with every diagram and piece. */
export interface OrgContext {
  map: () => SiteMap;
  mode: () => Mode;
  view: () => string;
  planned: () => boolean;
  filterTag: () => string | null;
  snapId: Ref<string | null>;
  isOpen: (diagramId: string, key: string) => boolean;
  toggle: (diagramId: string, key: string) => void;
  grab: (e: PointerEvent, el: HTMLElement, diagramId: string, piece: PieceModel) => void;
  plug: (e: PointerEvent, el: HTMLElement, piece: PieceModel) => void;
  setKind: (key: string, kind: BlockView['kind'] | null) => void;
  setRole: (key: string, role: BlockView['effectiveRole'] | null) => void;
  setTags: (key: string, tagIds: string[]) => void;
  restore: (key: string) => void;
  targetLabel: (target: Target | null) => string;
}

export const orgContextKey: InjectionKey<OrgContext> = Symbol('org');
