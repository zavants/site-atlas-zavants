import { describe, expect, it } from 'vitest';
import { mapLimit } from '../src/scan/limit.js';

describe('mapLimit', () => {
  it('respeta el máximo de tareas simultáneas y el orden de resultados', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(peak).toBe(3);
  });
});
