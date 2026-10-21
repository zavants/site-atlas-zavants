import { z } from 'zod';
import { StoredKindSchema } from './scan.js';

export const TagSchema = z.object({ id: z.string(), name: z.string(), color: z.string() });
export type Tag = z.infer<typeof TagSchema>;

export const OrphanSchema = z.object({
  key: z.string(),
  lastSeen: z.object({ page: z.string(), name: z.string() }),
  suggestion: z.string().nullable(),
});
export type Orphan = z.infer<typeof OrphanSchema>;

export const TargetSchema = z.union([z.object({ block: z.string() }), z.object({ page: z.string() })]);
export type Target = z.infer<typeof TargetSchema>;

const PointSchema = z.object({ x: z.number(), y: z.number() });

export const OverlaySchema = z.object({
  schemaVersion: z.literal(2),
  rev: z.number().int().nonnegative(),
  tags: z.array(TagSchema),
  blockTags: z.record(z.string(), z.array(z.string())),
  kindOverrides: z.record(z.string(), StoredKindSchema),
  plannedPages: z.array(z.object({ path: z.string(), title: z.string() })),
  plannedOrder: z.record(z.string(), z.array(z.string())),
  plannedDeletions: z.array(z.string()),
  newKeys: z.array(z.string()),
  orphans: z.array(OrphanSchema),
  layout: z.record(z.string(), PointSchema),
  /** Shared components by id, with the fingerprint and text used to reconcile them across scans. */
  components: z.record(z.string(), z.object({ fingerprint: z.string(), name: z.string(), excerpt: z.string().default('') })),
  linkEdits: z.record(z.string(), z.intersection(TargetSchema, z.object({ by: z.string() }))),
  addedLinks: z.array(z.object({ id: z.string(), from: z.string(), to: TargetSchema, label: z.string().optional(), by: z.string() })),
  /** Scanned links planned for removal, by linkId. */
  removedLinks: z.record(z.string(), z.object({ by: z.string() })).default({}),
  confirmations: z.record(z.string(), z.object({ at: z.string(), by: z.string(), note: z.string() })),
  /** Who proposed each change: keys `move|<blockKey>`, `delete|<blockKey>`, `newPage|<path>`, `reorder|<page>`. Missing means the canvas. */
  authors: z.record(z.string(), z.string()).default({}),
});
export type Overlay = z.infer<typeof OverlaySchema>;

export function emptyOverlay(): Overlay {
  return {
    schemaVersion: 2,
    rev: 0,
    tags: [],
    blockTags: {},
    kindOverrides: {},
    plannedPages: [],
    plannedOrder: {},
    plannedDeletions: [],
    newKeys: [],
    orphans: [],
    layout: {},
    components: {},
    linkEdits: {},
    addedLinks: [],
    removedLinks: {},
    confirmations: {},
    authors: {},
  };
}

/** Reads any stored overlay (v1 or v2) as v2. Throws a ZodError when it is invalid. */
export function migrateOverlay(raw: unknown): Overlay {
  if (typeof raw === 'object' && raw !== null && (raw as { schemaVersion?: unknown }).schemaVersion === 1) {
    return OverlaySchema.parse({ ...emptyOverlay(), ...raw, schemaVersion: 2 });
  }
  return OverlaySchema.parse(raw);
}
