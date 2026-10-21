import type { BlockView } from '../api';

/** Tags the canvas detects on its own, next to the person's tags. Ids never clash: user tag ids are not prefixed. */
export const AUTO_TAGS = ['auto:nav', 'auto:hero', 'auto:form', 'auto:cta', 'auto:default'] as const;
export type AutoTag = (typeof AUTO_TAGS)[number];

/**
 * Navigation for a header or nav; Hero for the section with the page's h1; Form when it has a form;
 * Call to action for a button-styled link or a button outside a form; Default when none applies.
 */
export function autoTags(b: BlockView): AutoTag[] {
  const { forms, links, buttons, headings } = b.components;
  const nav = b.tag === 'header' || b.tag === 'nav';
  const form = forms.length > 0;
  const cta = links.some((l) => l.cta) || (!form && buttons.length > 0);
  const out: AutoTag[] = [];
  if (nav) out.push('auto:nav');
  if (!nav && headings.some((h) => h.level === 1)) out.push('auto:hero');
  if (form) out.push('auto:form');
  if (cta) out.push('auto:cta');
  return out.length ? out : ['auto:default'];
}

export const hasTag = (b: BlockView, tag: string): boolean =>
  tag.startsWith('auto:') ? autoTags(b).includes(tag as AutoTag) : b.tags.includes(tag);
