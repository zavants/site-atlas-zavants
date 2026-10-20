import { createHash } from 'node:crypto';
import { en } from '../i18n/en.js';
import { normalizeUrl } from '../scan/crawl.js';
import type { Overlay, Target } from '../schema/overlay.js';
import type { Block, Issue, Scan } from '../schema/scan.js';
import { effectiveLinks, owner, resolveTarget } from './links.js';
import { effectiveOrders, indexScan, OpError, sameTarget, type OverlayOp, type ScanIndex } from './ops.js';
import { displaced } from './order.js';

// ops.ts imports applyConfirmation from here and this module imports helpers from ops.ts.
// The cycle is safe only while neither module uses the other at top level: keep it that way.

export type ChangeType = 'newPage' | 'move' | 'reorder' | 'delete' | 'relink' | 'addLink';
export type ChangeStatus = 'pending' | 'applied';

export interface Change {
  id: string;
  type: ChangeType;
  status: ChangeStatus;
  /** Whether the latest scan already reflects the change. Informational: it never sets `status`. */
  observed: boolean | null;
  summary: string;
  details: Record<string, unknown>;
  doneWhen: string;
  by: string;
  confirmation?: Overlay['confirmations'][string];
}

export type ConfirmationOp = Extract<OverlayOp, { type: 'confirmChange' | 'reopenChange' }>;

interface SectionInfo {
  blockKey: string;
  name: string;
  heading: string | null;
  anchor: string | null;
  excerpt: string;
}
interface SectionRef {
  blockKey: string;
  name: string;
}
interface TargetInfo {
  kind: 'section' | 'page' | 'planned' | 'missing' | 'external';
  page: string;
  section: SectionInfo | null;
}
interface IssueRef {
  id: string;
  rule: string;
  message: string;
}

/** `type:` + the first 10 hex chars of sha1(parts joined by newlines). Parts never include positions (spec §10b). */
export function changeId(type: ChangeType, parts: string[]): string {
  return `${type}:${createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 10)}`;
}

const targetIdentity = (t: Target): string => ('block' in t ? t.block : t.page);

/**
 * True when the owner's scanned links (edits ignored) include one whose resolved target equals
 * `target`: same page and, for a section target, its anchor (spec §10b "Links after a re-scan").
 */
export function observedLink(scan: Scan, overlay: Overlay, ownerId: string, target: Target): boolean {
  for (const page of scan.pages) {
    for (const block of page.blocks) {
      if (owner(block, overlay) !== ownerId) continue;
      for (const link of block.components.links) {
        const resolved = resolveTarget(link.href, scan, page.path);
        if (resolved && sameTarget(resolved, target)) return true;
      }
    }
  }
  return false;
}

/** The plan as a list of changes, in the order newPage, move, delete, reorder, relink, addLink. */
export function deriveChanges(scan: Scan, overlay: Overlay): Change[] {
  return new Planner(scan, overlay).changes();
}

class Planner {
  private readonly idx: ScanIndex;
  private readonly orders: Map<string, string[]>;
  private readonly deleted: Set<string>;
  private readonly placement = new Map<string, string>();

  constructor(
    private readonly scan: Scan,
    private readonly overlay: Overlay,
  ) {
    this.idx = indexScan(scan);
    this.orders = effectiveOrders(scan, overlay, this.idx);
    this.deleted = new Set(overlay.plannedDeletions);
    for (const [path, keys] of this.orders) for (const key of keys) this.placement.set(key, path);
  }

  changes(): Change[] {
    const all = [...this.newPages(), ...this.moves(), ...this.deletes(), ...this.reorders(), ...this.relinks(), ...this.addedLinks()];
    const seen = new Set<string>();
    return all
      .filter((c) => !seen.has(c.id) && seen.add(c.id))
      .map((c): Change => {
        const confirmation = this.overlay.confirmations[c.id];
        return confirmation ? { ...c, status: 'applied', confirmation } : c;
      });
  }

  private change(type: ChangeType, parts: string[], rest: Omit<Change, 'id' | 'type' | 'status'>): Change {
    return { id: changeId(type, parts), type, status: 'pending', ...rest };
  }

  // ---- helpers ----

  private block(key: string): Block {
    return this.idx.blocks.get(key)!.block;
  }

  private section(key: string): SectionInfo {
    const b = this.block(key);
    return { blockKey: b.key, name: b.name, heading: b.heading, anchor: b.anchor, excerpt: b.textExcerpt };
  }

  private ref(key: string | undefined): SectionRef | null {
    return key ? { blockKey: key, name: this.block(key).name } : null;
  }

  /** Planned order of a page without the sections planned for deletion. */
  private kept(path: string): string[] {
    return (this.orders.get(path) ?? []).filter((k) => this.idx.blocks.has(k) && !this.deleted.has(k));
  }

  private realPage(key: string): string {
    return this.idx.blocks.get(key)!.page;
  }

  private issueRefs(issues: Issue[]): IssueRef[] {
    return issues.map((i) => ({ id: i.id, rule: i.rule, message: i.message }));
  }

  /** `href` as it should appear on the site: the page path under the base path, plus the anchor. */
  private sitePath(path: string): string {
    const base = this.scan.environment.basePath.replace(/\/+$/, '');
    return (path === '/' ? `${base}/` : `${base}${path}`) || '/';
  }

  private targetInfo(t: Target): TargetInfo {
    if ('block' in t) {
      const page = this.placement.get(t.block) ?? this.realPage(t.block);
      return { kind: 'section', page, section: this.section(t.block) };
    }
    const kind: TargetInfo['kind'] = !t.page.startsWith('/')
      ? 'external'
      : this.idx.realOrder.has(t.page)
        ? 'page'
        : this.overlay.plannedPages.some((p) => p.path === t.page)
          ? 'planned'
          : 'missing';
    return { kind, page: t.page, section: null };
  }

  private href(t: Target): string {
    const info = this.targetInfo(t);
    if (info.kind === 'external') return info.page;
    const anchor = info.section?.anchor;
    return this.sitePath(info.page) + (anchor ? `#${anchor}` : '');
  }

  private targetLabel(t: Target): string {
    const info = this.targetInfo(t);
    return info.section ? en.plan.sectionTarget(info.section.name, this.href(t)) : this.href(t);
  }

  private hasKnownTarget(t: Target): boolean {
    return 'block' in t ? this.idx.blocks.has(t.block) : true;
  }

  /** Blocks of the scan owned by `id` (one per page for a component), with their page. */
  private ownedBlocks(id: string): { block: Block; page: string }[] {
    const out: { block: Block; page: string }[] = [];
    for (const page of this.scan.pages) {
      for (const block of page.blocks) if (owner(block, this.overlay) === id) out.push({ block, page: page.path });
    }
    return out;
  }

  private ownerInfo(id: string) {
    const blocks = this.ownedBlocks(id);
    const first = blocks[0]!.block;
    const component = this.overlay.components[id];
    const pages = [...new Set(blocks.map((b) => b.page))];
    const name = component ? component.name : first.name;
    const label = component ? en.plan.usedOn(name, pages.join(', ')) : en.plan.sectionOn(name, pages[0]!);
    return {
      label,
      info: { id, kind: component ? 'component' : 'section', name, pages, heading: first.heading, anchor: first.anchor, excerpt: first.textExcerpt },
    };
  }

  // ---- change types ----

  private newPages(): Change[] {
    return this.overlay.plannedPages.map((p) => {
      const resolves = this.scan.issues.filter((i) => {
        if (i.rule !== 'broken-link') return false;
        const t = resolveTarget(i.id.split('|').slice(3).join('|'), this.scan, i.page);
        return t !== null && 'page' in t && t.page === p.path;
      });
      return this.change('newPage', [p.path], {
        observed: this.idx.realOrder.has(p.path),
        summary: en.plan.summary.newPage(p.path, p.title),
        details: { page: p.path, title: p.title, sections: this.kept(p.path).map((k) => this.ref(k)), resolves: this.issueRefs(resolves) },
        doneWhen: en.plan.done.newPage(p.path),
        by: this.overlay.authors[`newPage|${p.path}`] ?? 'canvas',
      });
    });
  }

  private moves(): Change[] {
    const out: Change[] = [];
    for (const path of this.orders.keys()) {
      const kept = this.kept(path);
      kept.forEach((key, i) => {
        const from = this.realPage(key);
        if (from === path) return;
        const b = this.block(key);
        const target = this.scan.pages.find((p) => p.path === path);
        const observed = !!target?.blocks.some((o) => o.key !== key && (o.fingerprint === b.fingerprint || (!!b.anchor && o.anchor === b.anchor)));
        out.push(
          this.change('move', [key, path], {
            observed,
            summary: en.plan.summary.move(b.name, from, path),
            details: {
              section: this.section(key),
              fromPage: from,
              toPage: path,
              toPagePlanned: !this.idx.realOrder.has(path),
              position: i + 1,
              previousSection: this.ref(kept[i - 1]),
              nextSection: this.ref(kept[i + 1]),
              resolves: [],
            },
            doneWhen: en.plan.done.move(b.name, from, path),
            by: this.overlay.authors[`move|${key}`] ?? 'canvas',
          }),
        );
      });
    }
    return out;
  }

  private deletes(): Change[] {
    return this.overlay.plannedDeletions
      .filter((key) => this.idx.blocks.has(key))
      .map((key) => {
        const b = this.block(key);
        const page = this.realPage(key);
        return this.change('delete', [key], {
          // The change exists only while the scan still has the section.
          observed: false,
          summary: en.plan.summary.delete(b.name, page),
          details: { section: this.section(key), page, resolves: this.issueRefs(this.scan.issues.filter((i) => i.blockKey === key)) },
          doneWhen: en.plan.done.delete(b.name, page),
          by: this.overlay.authors[`delete|${key}`] ?? 'canvas',
        });
      });
  }

  private reorders(): Change[] {
    const out: Change[] = [];
    for (const [path, real] of this.idx.realOrder) {
      const kept = this.kept(path);
      const stays = new Set(kept.filter((k) => this.realPage(k) === path));
      const realKept = real.filter((k) => stays.has(k));
      const shifted = displaced(realKept, kept.filter((k) => stays.has(k)));
      kept.forEach((key, i) => {
        if (!shifted.has(key)) return;
        const name = this.block(key).name;
        const prev = kept[i - 1];
        const prevName = prev ? this.block(prev).name : null;
        const realIdx = realKept.indexOf(key);
        out.push(
          this.change('reorder', [key, path, prev ?? 'start'], {
            observed: (realKept[realIdx - 1] ?? null) === (prev ?? null),
            summary: prevName ? en.plan.summary.reorderAfter(name, path, prevName) : en.plan.summary.reorderFirst(name, path),
            details: { section: this.section(key), page: path, position: i + 1, previousSection: this.ref(prev), nextSection: this.ref(kept[i + 1]), resolves: [] },
            doneWhen: prevName ? en.plan.done.reorderAfter(name, path, prevName) : en.plan.done.reorderFirst(name, path),
            by: this.overlay.authors[`reorder|${path}`] ?? 'canvas',
          }),
        );
      });
    }
    return out;
  }

  private relinks(): Change[] {
    const out: Change[] = [];
    const done = new Set<string>();
    for (const page of this.scan.pages) {
      for (const block of page.blocks) {
        for (const link of effectiveLinks(block, this.scan, this.overlay)) {
          if (!link.edited || !link.target || done.has(link.id) || !this.hasKnownTarget(link.target)) continue;
          done.add(link.id);
          const target = link.target;
          const { label, info } = this.ownerInfo(link.owner);
          const text = link.text.trim() || link.href;
          const current = resolveTarget(link.href, this.scan, page.path);
          const hrefs = new Set([link.href, normalizeUrl(link.href, this.scan.environment.origin + this.scan.environment.basePath)]);
          const owned = new Set(this.ownedBlocks(link.owner).map((b) => b.block.key));
          const resolves = this.scan.issues.filter(
            (i) => (i.rule === 'broken-link' || i.rule === 'missing-anchor') && owned.has(i.blockKey ?? '') && hrefs.has(i.id.split('|').slice(3).join('|')),
          );
          const href = this.href(target);
          const targetInfo = this.targetInfo(target);
          out.push(
            this.change('relink', [link.id, targetIdentity(target)], {
              observed: observedLink(this.scan, this.overlay, link.owner, target),
              summary: en.plan.summary.relink(text, label, this.targetLabel(target)),
              details: {
                linkId: link.id,
                owner: info,
                linkText: link.text.trim(),
                currentHref: link.href,
                currentTarget: current && this.hasKnownTarget(current) ? this.targetInfo(current) : null,
                target: targetInfo,
                suggestedHref: href,
                needsAnchor: targetInfo.kind === 'section' && !targetInfo.section?.anchor,
                resolves: this.issueRefs(resolves),
              },
              doneWhen: en.plan.done.relink(text, label, href),
              by: link.by ?? 'canvas',
            }),
          );
        }
      }
    }
    return out;
  }

  private addedLinks(): Change[] {
    return this.overlay.addedLinks
      .filter((l) => this.hasKnownTarget(l.to) && this.ownedBlocks(l.from).length > 0)
      .map((l) => {
        const { label, info } = this.ownerInfo(l.from);
        const href = this.href(l.to);
        const targetInfo = this.targetInfo(l.to);
        return this.change('addLink', [l.from, targetIdentity(l.to)], {
          observed: observedLink(this.scan, this.overlay, l.from, l.to),
          summary: en.plan.summary.addLink(label, this.targetLabel(l.to), l.label ?? null),
          details: {
            linkId: l.id,
            owner: info,
            label: l.label ?? null,
            target: targetInfo,
            suggestedHref: href,
            needsAnchor: targetInfo.kind === 'section' && !targetInfo.section?.anchor,
            resolves: [],
          },
          doneWhen: en.plan.done.addLink(label, href),
          by: l.by,
        });
      });
  }
}

/** `confirmChange` / `reopenChange`: the only way a change becomes applied or pending again. Scans never touch this. */
export function applyConfirmation(overlay: Overlay, scan: Scan, op: ConfirmationOp): Overlay {
  const note = op.note.trim();
  if (!note) throw new OpError(en.op.noteRequired);
  if (!deriveChanges(scan, overlay).some((c) => c.id === op.changeId)) throw new OpError(en.op.changeNotInPlan(op.changeId));
  const confirmations = { ...overlay.confirmations };
  if (op.type === 'confirmChange') {
    confirmations[op.changeId] = { at: new Date().toISOString(), by: op.by, note };
  } else {
    if (!(op.changeId in confirmations)) throw new OpError(en.op.notApplied(op.changeId));
    delete confirmations[op.changeId];
  }
  return { ...overlay, confirmations };
}
