import { en } from '../i18n/en.js';
import type { Block, Issue, Page } from '../schema/scan.js';
import { normalizeUrl } from './crawl.js';

export interface IssueContext {
  /** Estado HTTP por URL normalizada (0 = no respondió). */
  linkStatus: Map<string, number>;
  idsByPath: Map<string, Set<string>>;
  pageInfo: Map<string, { h1Count: number; duplicateIds: string[] }>;
  /** Ruta de página para una URL dentro del sitio escaneado, o `null`. */
  pathOf: (url: string) => string | null;
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const PLACEHOLDER = /placeholder|provisional|lorem|dummy/i;

const isContent = (b: Block) => !b.global && b.tag !== 'header' && b.tag !== 'footer';

export function computeIssues(pages: Page[], ctx: IssueContext): Issue[] {
  const out: Issue[] = [];
  const add = (level: Issue['level'], rule: Issue['rule'], page: string, blockKey: string | null, detail: string, message: string) => {
    const id = [rule, page, blockKey ?? '', detail].join('|');
    if (!out.some((i) => i.id === id)) out.push({ id, level, rule, page, blockKey, message });
  };

  for (const page of pages) {
    const info = ctx.pageInfo.get(page.path);
    if (info && info.h1Count !== 1) {
      add('warn', 'heading', page.path, null, 'h1', en.issue.h1Count(info.h1Count));
    }
    for (const id of info?.duplicateIds ?? []) {
      add('warn', 'duplicate-id', page.path, null, id, en.issue.duplicateId(id));
    }

    for (const block of page.blocks) {
      const { links, forms, media } = block.components;
      for (const link of links) {
        if (link.kind === 'anchor') {
          const id = safeDecode(link.href.slice(1));
          if (id && !ctx.idsByPath.get(page.path)?.has(id)) {
            add('error', 'missing-anchor', page.path, block.key, link.href, en.issue.missingAnchor(link.href));
          }
          continue;
        }
        if (link.kind !== 'internal') continue;
        const target = normalizeUrl(link.href, link.href);
        if (!target) continue;
        const status = ctx.linkStatus.get(target);
        if (status !== undefined && (status === 0 || status >= 400)) {
          const shown = new URL(target).pathname;
          add('error', 'broken-link', page.path, block.key, target, en.issue.brokenLink(shown, status));
          continue;
        }
        const hash = new URL(link.href).hash.slice(1);
        const targetPath = ctx.pathOf(target);
        const ids = targetPath === null ? undefined : ctx.idsByPath.get(targetPath);
        if (hash && ids && !ids.has(safeDecode(hash))) {
          add('error', 'missing-anchor', page.path, block.key, link.href, en.issue.missingAnchorOnPage(targetPath!, hash));
        }
      }
      forms.forEach((form, i) => {
        if (!form.action) add('warn', 'form-no-action', page.path, block.key, String(i), en.issue.formNoAction);
      });
      for (const m of media) {
        if (m.type === 'img' && (PLACEHOLDER.test(m.src ?? '') || PLACEHOLDER.test(m.alt ?? ''))) {
          const file = (m.src ?? '').split('/').pop() ?? '';
          add('warn', 'placeholder-image', page.path, block.key, m.src ?? '', en.issue.placeholderImage(file));
        }
      }
      if (isContent(block)) {
        if (!block.anchor) add('info', 'block-no-anchor', page.path, block.key, '', en.issue.blockNoAnchor(block.name));
        if (!block.heading) add('warn', 'heading', page.path, block.key, 'h2', en.issue.blockNoHeading(block.name));
      }
    }
  }
  return out;
}
