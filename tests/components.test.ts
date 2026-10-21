import { describe, expect, it } from 'vitest';
import { assignComponents, componentOf } from '../src/model/components.js';
import { emptyOverlay } from '../src/schema/overlay.js';
import type { Block, Page, Scan } from '../src/schema/scan.js';
import { sampleScan } from './helpers/sample.js';

const hdr = (path: string, fingerprint: string, textExcerpt: string): Block => ({
  ...sampleScan().pages[0]!.blocks[0]!,
  key: `${path}~header`,
  fingerprint,
  textExcerpt,
  isComponent: true,
});
const scanOf = (...headers: Block[]): Scan => {
  const base = sampleScan();
  const pages: Page[] = headers.map((h, i) => ({ ...base.pages[0]!, path: `/p${i}`, blocks: [h] }));
  return { ...base, pages };
};

describe('assignComponents', () => {
  it('names a single header Header 1', () => {
    const c = assignComponents(emptyOverlay(), scanOf(hdr('/p0', 'aaa', 'Inicio Productos Contacto')));
    expect(c).toEqual({ 'c:aaa': expect.objectContaining({ name: 'Header 1', fingerprint: 'aaa' }) });
  });

  it('numbers dissimilar headers Header 1 and Header 2', () => {
    const c = assignComponents(
      emptyOverlay(),
      scanOf(hdr('/p0', 'aaa', 'Inicio Productos Contacto'), hdr('/p1', 'bbb', 'Zzzz qqqq wwww xxxx yyyy')),
    );
    expect(Object.values(c).map((x) => x.name).sort()).toEqual(['Header 1', 'Header 2']);
  });

  it('numbers similar headers with different fingerprints in one scan Header 1 and Header 2', () => {
    const c = assignComponents(
      emptyOverlay(),
      scanOf(
        hdr('/p0', 'aaa', 'Inicio Productos Servicios Nosotros Contacto'),
        hdr('/p1', 'bbb', 'Inicio Productos Servicios Nosotros Contacto Blog'),
      ),
    );
    expect(c['c:aaa']!.name).toBe('Header 1');
    expect(c['c:bbb']!.name).toBe('Header 2');
  });

  it('keeps id and name when the text changes slightly', () => {
    const first = assignComponents(emptyOverlay(), scanOf(hdr('/p0', 'aaa', 'Inicio Productos Servicios Nosotros Contacto')));
    const again = assignComponents(
      { ...emptyOverlay(), components: first },
      scanOf(hdr('/p0', 'ccc', 'Inicio Productos Servicios Nosotros Contactos')),
    );
    expect(Object.keys(again)).toEqual(['c:aaa']);
    expect(again['c:aaa']!.name).toBe('Header 1');
  });

  it('keeps components that no longer appear and numbers footers apart', () => {
    const first = assignComponents(emptyOverlay(), scanOf(hdr('/p0', 'aaa', 'Inicio Productos')));
    const footer: Block = { ...hdr('/p0', 'fff', 'Derechos reservados'), tag: 'footer', key: '/p0~footer' };
    const next = assignComponents({ ...emptyOverlay(), components: first }, scanOf(footer));
    expect(next['c:aaa']!.name).toBe('Header 1');
    expect(next['c:fff']!.name).toBe('Footer 1');
  });
});

describe('componentOf', () => {
  it('finds the component id of a block, or null', () => {
    const components = { 'c:aaa': { fingerprint: 'aaa', name: 'Header 1', excerpt: 'Inicio Productos' } };
    expect(componentOf(hdr('/p0', 'aaa', 'x'), components)).toBe('c:aaa');
    expect(componentOf(hdr('/p0', 'zzz', 'Inicio Productos'), components)).toBe('c:aaa');
    expect(componentOf({ ...hdr('/p0', 'zzz', 'nada'), isComponent: false }, components)).toBeNull();
    expect(componentOf(hdr('/p0', 'zzz', 'completamente distinto'), components)).toBeNull();
  });
});
