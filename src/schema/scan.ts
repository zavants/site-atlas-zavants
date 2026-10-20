import { z } from 'zod';

export const KindSchema = z.enum(['narrative', 'visual', 'conversion']);
export type Kind = z.infer<typeof KindSchema>;

/** Reads v1 data, where the narrative kind was stored as `narrativa`. */
export const StoredKindSchema = z.preprocess((v) => (v === 'narrativa' ? 'narrative' : v), KindSchema);

export const ComponentsSchema = z.object({
  headings: z.array(z.object({ level: z.number(), text: z.string() })),
  links: z.array(z.object({ text: z.string(), href: z.string(), kind: z.enum(['internal', 'external', 'anchor']) })),
  buttons: z.array(z.string()),
  forms: z.array(z.object({ fields: z.number(), action: z.string().nullable(), method: z.string() })),
  media: z.array(
    z.object({ type: z.enum(['img', 'video', 'canvas']), src: z.string().optional(), alt: z.string().optional() }),
  ),
});
export type Components = z.infer<typeof ComponentsSchema>;

export const BlockSchema = z.object({
  key: z.string(),
  name: z.string(),
  heading: z.string().nullable(),
  anchor: z.string().nullable(),
  tag: z.string(),
  order: z.number(),
  height: z.number(),
  kind: StoredKindSchema,
  global: z.boolean(),
  fingerprint: z.string(),
  textExcerpt: z.string(),
  components: ComponentsSchema,
  shot: z.string().nullable(),
});
export type Block = z.infer<typeof BlockSchema>;

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
