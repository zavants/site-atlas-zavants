import { z } from 'zod';
import { KindSchema } from './scan.js';

export const TagSchema = z.object({ id: z.string(), name: z.string(), color: z.string() });
export type Tag = z.infer<typeof TagSchema>;

export const OrphanSchema = z.object({
  key: z.string(),
  lastSeen: z.object({ page: z.string(), name: z.string() }),
  suggestion: z.string().nullable(),
});
export type Orphan = z.infer<typeof OrphanSchema>;

export const OverlaySchema = z.object({
  schemaVersion: z.literal(1),
  rev: z.number().int().nonnegative(),
  tags: z.array(TagSchema),
  blockTags: z.record(z.string(), z.array(z.string())),
  kindOverrides: z.record(z.string(), KindSchema),
  plannedPages: z.array(z.object({ path: z.string(), title: z.string() })),
  plannedOrder: z.record(z.string(), z.array(z.string())),
  plannedDeletions: z.array(z.string()),
  newKeys: z.array(z.string()),
  orphans: z.array(OrphanSchema),
});
export type Overlay = z.infer<typeof OverlaySchema>;

export function emptyOverlay(): Overlay {
  return {
    schemaVersion: 1,
    rev: 0,
    tags: [],
    blockTags: {},
    kindOverrides: {},
    plannedPages: [],
    plannedOrder: {},
    plannedDeletions: [],
    newKeys: [],
    orphans: [],
  };
}
