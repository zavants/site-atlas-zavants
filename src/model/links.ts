import { normalizeUrl } from '../scan/crawl.js';
import type { Overlay, Target } from '../schema/overlay.js';
import type { Block, Scan } from '../schema/scan.js';
import { pagePath } from '../store/paths.js';
import { componentOf } from './components.js';

export interface EffectiveLink {
  id: string;
  owner: string;
  text: string;
  href: string;
  target: Target | null;
  edited: boolean;
  added: boolean;
  by?: string;
}

/** Component id when the block is a shared component, else its block key. */
export function owner(block: Block, overlay: Overlay): string {
  return componentOf(block, overlay.components) ?? block.key;
}

export function linkId(ownerId: string, href: string, text: string): string {
  return `${ownerId}|${href}|${text.trim()}`;
}

/** Where a link points: a section, a page (real, planned or missing), or an external origin. */
export function resolveTarget(href: string, scan: Scan, fromPath: string): Target | null {
  const { origin, basePath } = scan.environment;
  const blockAt = (path: string, anchor: string): Target | null => {
    const found = scan.pages.find((p) => p.path === path)?.blocks.find((b) => b.anchor === anchor);
    return found ? { block: found.key } : null;
  };
  if (href.startsWith('#')) {
    const anchor = href.slice(1);
    return anchor ? blockAt(fromPath, anchor) : null;
  }
  let url: URL;
  try {
    url = new URL(href, origin + basePath);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.origin !== origin) return { page: url.origin };
  const normalized = normalizeUrl(url.toString(), origin + basePath);
  if (!normalized) return null;
  const path = pagePath(new URL(normalized).pathname, basePath);
  const anchor = url.hash.slice(1);
  return (anchor && blockAt(path, anchor)) || { page: path };
}

function pageOf(scan: Scan, block: Block): string {
  return scan.pages.find((p) => p.blocks.some((b) => b.key === block.key))?.path ?? '/';
}

/** Added links first, then the scanned links with the overlay edits applied. */
export function effectiveLinks(block: Block, scan: Scan, overlay: Overlay): EffectiveLink[] {
  const id = owner(block, overlay);
  const added: EffectiveLink[] = overlay.addedLinks
    .filter((l) => l.from === id)
    .map((l) => ({ id: l.id, owner: id, text: l.label ?? '', href: '', target: l.to, edited: false, added: true, by: l.by }));
  const fromPath = pageOf(scan, block);
  const scanned: EffectiveLink[] = block.components.links.map((l) => {
    const linkKey = linkId(id, l.href, l.text);
    const edit = overlay.linkEdits[linkKey];
    if (!edit) {
      return { id: linkKey, owner: id, text: l.text, href: l.href, target: resolveTarget(l.href, scan, fromPath), edited: false, added: false };
    }
    const { by, ...target } = edit;
    return { id: linkKey, owner: id, text: l.text, href: l.href, target: target as Target, edited: true, added: false, by };
  });
  return [...added, ...scanned];
}

/** Origins of every external link in the scan, to validate external targets. */
export function externalOrigins(scan: Scan): Set<string> {
  const out = new Set<string>();
  for (const page of scan.pages) {
    for (const block of page.blocks) {
      for (const l of block.components.links) {
        const t = l.kind === 'external' ? resolveTarget(l.href, scan, page.path) : null;
        if (t && 'page' in t && !t.page.startsWith('/')) out.add(t.page);
      }
    }
  }
  return out;
}
