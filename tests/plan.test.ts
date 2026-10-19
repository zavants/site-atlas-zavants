import { describe, expect, it } from 'vitest';
import { buildMap } from '../src/model/map.js';
import { applyOp, type OverlayOp } from '../src/model/ops.js';
import { describePlan, diffPlan } from '../src/model/plan.js';
import { emptyOverlay } from '../src/schema/overlay.js';
import { sampleScan } from './helpers/sample.js';

const scan = sampleScan();
const mapAfter = (...ops: OverlayOp[]) => buildMap(scan, ops.reduce((o, op) => applyOp(o, scan, op), emptyOverlay()));

describe('diffPlan', () => {
  it('reporta página nueva, movimiento, eliminación y reorden en ese orden', () => {
    const diffs = diffPlan(
      mapAfter(
        { type: 'addPlannedPage', path: '/soluciones', title: 'Soluciones' },
        { type: 'moveBlock', blockKey: '/~integraciones', toPage: '/soluciones', index: 0 },
        { type: 'markDeleted', blockKey: '/otra#precios' },
        { type: 'moveBlock', blockKey: '/#cotizacion', toPage: '/', index: 0 },
      ),
    );
    expect(diffs.map((d) => d.type)).toEqual(['newPage', 'move', 'delete', 'reorder']);
    expect(diffs[1]).toEqual({ type: 'move', blockKey: '/~integraciones', name: 'Integraciones', fromPage: '/', toPage: '/soluciones', index: 0 });
    expect(diffs[3]).toEqual({ type: 'reorder', page: '/', from: ['Hero', 'Cierre'], to: ['Cierre', 'Hero'] });
    const text = describePlan(diffs);
    expect(text).toContain('Mover "Integraciones" de / a /soluciones (posición 1)');
    expect(text.split('\n')).toHaveLength(4);
  });

  it('no reporta nada si el plan coincide con el sitio', () => {
    const diffs = diffPlan(mapAfter({ type: 'moveBlock', blockKey: '/#top', toPage: '/', index: 0 }));
    expect(diffs).toEqual([]);
    expect(describePlan([])).toBe('El sitio ya coincide con el plan.');
  });
});
