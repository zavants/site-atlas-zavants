import type { BlockView } from '../api';

/** Tags the canvas detects on its own, next to the person's tags. Ids never clash: user tag ids are not prefixed. */
export const AUTO_TAGS = ['auto:form', 'auto:cta', 'auto:default'] as const;
export type AutoTag = (typeof AUTO_TAGS)[number];

/** Form when the section has a form; call to action when it has a button-styled link or a button outside a form; else Default. */
export function autoTags(b: BlockView): AutoTag[] {
  const { forms, links, buttons } = b.components;
  const form = forms.length > 0;
  const cta = links.some((l) => l.cta) || (!form && buttons.length > 0);
  const out: AutoTag[] = [];
  if (form) out.push('auto:form');
  if (cta) out.push('auto:cta');
  return out.length ? out : ['auto:default'];
}

export const hasTag = (b: BlockView, tag: string): boolean =>
  tag.startsWith('auto:') ? autoTags(b).includes(tag as AutoTag) : b.tags.includes(tag);
