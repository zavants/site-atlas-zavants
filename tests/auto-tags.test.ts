import { describe, expect, it } from 'vitest';
import { autoTags, roleLabel } from '../canvas/src/org/autoTags.js';
import { buildMap } from '../src/model/map.js';
import { emptyOverlay } from '../src/schema/overlay.js';
import { ScanSchema } from '../src/schema/scan.js';
import { sampleScan } from './helpers/sample.js';

/**
 * A scan file as it was written before roles existed: no `role`, no `roles`, no `cta`,
 * no `roleReasons` and no `signals`. The canvas used to read the chips off `components`,
 * so those sections must keep their labels (spec §5.4).
 */
function legacyScan() {
  const scan = sampleScan();
  const hero = scan.pages[0]!.blocks[1]!;
  hero.components.headings = [{ level: 1, text: 'Bienvenidos' }];
  hero.components.links = [{ text: 'Go', href: '/x', kind: 'internal', cta: true }];
  const raw = JSON.parse(JSON.stringify(scan)) as { pages: { blocks: Record<string, unknown>[] }[] };
  for (const page of raw.pages) {
    for (const block of page.blocks) {
      for (const field of ['role', 'roles', 'cta', 'roleReasons', 'signals']) delete block[field];
    }
  }
  return ScanSchema.parse(raw);
}

describe('autoTags', () => {
  const map = buildMap(legacyScan(), emptyOverlay());
  const blocks = [...map.globals, ...map.pages.flatMap((p) => p.blocks)];
  const chips = (key: string) => autoTags(blocks.find((b) => b.key === key)!);

  it('keeps the chips of a scan made before roles existed', () => {
    expect(chips('/~header')).toEqual(['auto:navigation']);
    expect(chips('/~footer')).toEqual(['auto:footer']);
    expect(chips('/#top')).toEqual(['auto:hero', 'auto:cta']);
    // Its anchor says "cotizacion", a contact word, and it holds the page's form.
    expect(chips('/#cotizacion')).toEqual(['auto:contact']);
    // Nothing to go on: this one really is Default.
    expect(chips('/~integraciones')).toEqual(['auto:default']);
    expect(roleLabel('auto:navigation')).toBe('Navigation');
  });
});
