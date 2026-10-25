import { z } from 'zod';

export const KindSchema = z.enum(['narrative', 'visual', 'conversion']);
export type Kind = z.infer<typeof KindSchema>;

/** Reads v1 data, where the narrative kind was stored as `narrativa`. */
export const StoredKindSchema = z.preprocess((v) => (v === 'narrativa' ? 'narrative' : v), KindSchema);

/** What a section is, in the vocabulary of marketing sites. The ids are stored in overlays and never change. */
export const SectionRoleSchema = z.enum([
  'navigation',
  'footer',
  'hero',
  'form',
  'contact',
  'pricing',
  'faq',
  'testimonials',
  'logos',
  'stats',
  'steps',
  'audience',
  'solutions',
  'products',
  'team',
  'about',
  'gallery',
  'banner',
  'features',
  'feature',
  'content',
  'default',
]);
export type SectionRole = z.infer<typeof SectionRoleSchema>;

/** Structure counted in the page by the extraction, read by the role classifier. */
export const SignalsSchema = z.object({
  /** Words of visible text. */
  words: z.number(),
  /** Largest run of two or more consecutive siblings of the same tag, each holding a heading or an image. */
  cards: z.number(),
  cardHeadingLevel: z.number().nullable(),
  listItems: z.number(),
  orderedItems: z.number(),
  /** Short texts like "01" or "3)". */
  numbered: z.number(),
  accordions: z.number(),
  quotes: z.number(),
  prices: z.number(),
  /** Numbers set in 32px or more. */
  bigNumbers: z.number(),
  questions: z.number(),
  smallImages: z.number(),
  largeImages: z.number(),
  /** Largest single image, video or canvas area ÷ block area. */
  imageRatio: z.number(),
  tabs: z.number(),
  /** tel:/mailto: links, an address element, phone-like text. */
  contactHints: z.number(),
});
export type Signals = z.infer<typeof SignalsSchema>;

export const ComponentsSchema = z.object({
  headings: z.array(z.object({ level: z.number(), text: z.string() })),
  links: z.array(
    z.object({
      text: z.string(),
      href: z.string(),
      kind: z.enum(['internal', 'external', 'anchor']),
      /** Styled as a button (btn/button/cta class or role=button). Missing in older scans. */
      cta: z.boolean().optional(),
    }),
  ),
  buttons: z.array(z.string()),
  forms: z.array(z.object({ fields: z.number(), action: z.string().nullable(), method: z.string() })),
  media: z.array(
    z.object({ type: z.enum(['img', 'video', 'canvas']), src: z.string().optional(), alt: z.string().optional() }),
  ),
});
export type Components = z.infer<typeof ComponentsSchema>;

const BaseBlockSchema = z.object({
  key: z.string(),
  name: z.string(),
  heading: z.string().nullable(),
  anchor: z.string().nullable(),
  tag: z.string(),
  order: z.number(),
  height: z.number(),
  kind: StoredKindSchema,
  global: z.boolean(),
  isComponent: z.boolean(),
  fingerprint: z.string(),
  textExcerpt: z.string(),
  components: ComponentsSchema,
  shot: z.string().nullable(),
  /** Missing in scans made before roles existed. */
  signals: SignalsSchema.optional(),
  role: SectionRoleSchema.default('default'),
  /** Up to two roles the section also matches. */
  roles: z.array(SectionRoleSchema).default([]),
  cta: z.boolean().default(false),
  /** Short rule names behind the role ("cards>=3", "kw:steps"), for agents and debugging. */
  roleReasons: z.array(z.string()).default([]),
});
/** Reads v1 scans, which lack `isComponent`: header/footer tags and global blocks count as components. */
export const BlockSchema = z.preprocess((v) => {
  if (typeof v !== 'object' || v === null || 'isComponent' in v) return v;
  const b = v as { tag?: unknown; global?: unknown };
  return { ...b, isComponent: b.tag === 'header' || b.tag === 'footer' || b.global === true };
}, BaseBlockSchema);
export type Block = z.infer<typeof BaseBlockSchema>;

export const PageSchema = z.object({
  path: z.string(),
  url: z.string(),
  title: z.string(),
  status: z.number(),
  error: z.string().nullable(),
  blocks: z.array(BlockSchema),
});
export type Page = z.infer<typeof PageSchema>;

export const IssueRuleSchema = z.enum([
  'broken-link',
  'missing-anchor',
  'form-no-action',
  'placeholder-image',
  'block-no-anchor',
  'heading',
  'duplicate-id',
]);

export const IssueSchema = z.object({
  id: z.string(),
  level: z.enum(['error', 'warn', 'info']),
  rule: IssueRuleSchema,
  page: z.string(),
  blockKey: z.string().nullable(),
  message: z.string(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const ScanSchema = z.object({
  schemaVersion: z.literal(1),
  scanId: z.string(),
  site: z.string(),
  environment: z.object({ origin: z.string(), basePath: z.string() }),
  startedAt: z.string(),
  finishedAt: z.string(),
  pages: z.array(PageSchema),
  /** Rutas del sitio que respondieron 404/410: sus bloques organizados pasan a huérfanos. */
  missingPages: z.array(z.string()).default([]),
  /** Cómo se lanzó el escaneo, para repetirlo igual desde el lienzo. */
  options: z
    .object({
      startUrl: z.string(),
      maxPages: z.number().optional(),
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
  issues: z.array(IssueSchema),
});
export type Scan = z.infer<typeof ScanSchema>;
