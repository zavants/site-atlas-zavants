import { en } from '../i18n/en.js';
import type { SiteMap } from './map.js';
import { displaced } from './order.js';

export type PlanDiff =
  | { type: 'newPage'; path: string; title: string }
  | { type: 'move'; blockKey: string; name: string; fromPage: string; toPage: string; index: number }
  | { type: 'delete'; blockKey: string; name: string; page: string }
  | { type: 'reorder'; page: string; from: string[]; to: string[] };

export function diffPlan(map: SiteMap): PlanDiff[] {
  const newPages: PlanDiff[] = [];
  const moves: PlanDiff[] = [];
  const deletes: PlanDiff[] = [];
  const reorders: PlanDiff[] = [];

  for (const page of map.pages) {
    if (page.planned) newPages.push({ type: 'newPage', path: page.path, title: page.title });
    page.blocks.forEach((b, index) => {
      if (b.page !== page.path) moves.push({ type: 'move', blockKey: b.key, name: b.name, fromPage: b.page, toPage: page.path, index });
      if (b.deleted) deletes.push({ type: 'delete', blockKey: b.key, name: b.name, page: page.path });
    });
    const kept = page.blocks.filter((b) => b.page === page.path && !b.deleted);
    const keptKeys = new Set(kept.map((b) => b.key));
    const names = new Map(kept.map((b) => [b.key, b.name]));
    const to = kept.map((b) => b.key);
    const from = page.realOrder.filter((k) => keptKeys.has(k));
    if (from.join('\n') !== to.join('\n')) {
      reorders.push({ type: 'reorder', page: page.path, from: from.map((k) => names.get(k)!), to: to.map((k) => names.get(k)!) });
    }
  }
  return [...newPages, ...moves, ...deletes, ...reorders];
}

export function describePlan(diffs: PlanDiff[]): string {
  if (!diffs.length) return en.plan.inSync;
  return diffs
    .map((d) => {
      switch (d.type) {
        case 'newPage':
          return en.plan.newPage(d.path, d.title);
        case 'move':
          return en.plan.move(d.name, d.fromPage, d.toPage, d.index + 1);
        case 'delete':
          return en.plan.delete(d.name, d.page);
        case 'reorder': {
          const shifted = displaced(d.from, d.to);
          const changes = d.to.flatMap((n, i) => (shifted.has(n) ? [en.plan.reorderChange(n, i + 1)] : []));
          return en.plan.reorder(d.page, changes.join('; '));
        }
      }
    })
    .join('\n');
}
