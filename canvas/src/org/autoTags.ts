import { reactive } from 'vue';
import type { BlockView } from '../api';
import { t } from '../strings';
import { ROLE_ORDER } from '../../../src/scan/roles.js';
import type { SectionRole } from '../../../src/schema/scan.js';

/** Tags the canvas detects on its own, next to the person's tags. Ids never clash: user tag ids are not prefixed. */
export type AutoTag = `auto:${SectionRole}` | 'auto:cta';

/** One id per role, in the classifier's precedence order. */
export const ROLE_IDS: AutoTag[] = ROLE_ORDER.map((r): AutoTag => `auto:${r}`);
export const AUTO_TAGS: AutoTag[] = [...ROLE_IDS, 'auto:cta'];

/** 'auto:pricing' → 'Pricing'. The role ids are stored in overlays; only the label is translated. */
export const roleLabel = (id: AutoTag): string => t.roles[id.slice('auto:'.length) as SectionRole | 'cta'];

/**
 * The role the scanner detected (or the one the person corrected), plus a Call to action chip
 * when the section has a button-styled link or a button outside a form.
 */
export function autoTags(b: BlockView): AutoTag[] {
  return [`auto:${b.effectiveRole}`, ...(b.cta ? (['auto:cta'] as const) : [])];
}

export const hasTag = (b: BlockView, tag: string): boolean =>
  tag.startsWith('auto:') ? autoTags(b).includes(tag as AutoTag) : b.tags.includes(tag);

/**
 * One color per role, by family: structure violet, conversion green, visual pink, content gray-blue.
 * Navigation, Hero, Form and Call to action keep the colors the canvas has always used, and
 * Default stays gray; every other one can be recolored from Options.
 */
export const DEFAULT_AUTO_COLORS: Record<AutoTag, string> = {
  'auto:navigation': '#7f77dd',
  'auto:footer': '#6b64bd',
  'auto:hero': '#d4537e',
  'auto:form': '#1d9e75',
  'auto:contact': '#17a28c',
  'auto:pricing': '#2f9e52',
  'auto:faq': '#4d7fa8',
  'auto:testimonials': '#5f86b3',
  'auto:logos': '#c86fb0',
  'auto:stats': '#3f8fb0',
  'auto:steps': '#5a81c4',
  'auto:audience': '#6e7fb8',
  'auto:solutions': '#4a8ab2',
  'auto:products': '#3d94a6',
  'auto:team': '#7a8bb5',
  'auto:about': '#67839e',
  'auto:gallery': '#c0619b',
  'auto:banner': '#b86a9c',
  'auto:features': '#4f86c6',
  'auto:feature': '#6896cc',
  'auto:content': '#7d8a99',
  'auto:default': '#888780',
  'auto:cta': '#378add',
};
export const CONFIGURABLE: AutoTag[] = AUTO_TAGS.filter((id) => id !== 'auto:default');

const KEY = 'site-atlas:auto-tag-colors';
/** Colors saved before roles existed used 'auto:nav'; that one becomes 'auto:navigation'. */
function load(): Partial<Record<AutoTag, string>> {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
    const out: Partial<Record<AutoTag, string>> = {};
    for (const id of AUTO_TAGS) {
      const color = stored[id];
      if (color) out[id] = color;
    }
    const nav = stored['auto:nav'];
    if (nav && !out['auto:navigation']) out['auto:navigation'] = nav;
    return out;
  } catch {
    return {};
  }
}
/** A per-browser preference: the colors are a way of looking at the map, not part of the plan. */
export const autoColors = reactive<Record<AutoTag, string>>({
  ...DEFAULT_AUTO_COLORS,
  ...load(),
  'auto:default': DEFAULT_AUTO_COLORS['auto:default'],
});
export function saveAutoColors() {
  try {
    localStorage.setItem(KEY, JSON.stringify(autoColors));
  } catch {
    // Storage blocked: the colors last for this visit only.
  }
}
export function resetAutoColors() {
  Object.assign(autoColors, DEFAULT_AUTO_COLORS);
  saveAutoColors();
}
