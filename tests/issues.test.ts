import { describe, expect, it } from 'vitest';
import { computeIssues, type IssueContext } from '../src/scan/issues.js';
import type { Page } from '../src/schema/scan.js';
import { sampleScan } from './helpers/sample.js';

function pages(): Page[] {
  const scan = sampleScan();
  const home = scan.pages[0]!;
  const hero = home.blocks[1]!;
  hero.components.links = [
    { text: 'Ver', href: 'http://localhost:4405/no-existe', kind: 'internal' },
    { text: 'Fantasma', href: '#fantasma', kind: 'anchor' },
    { text: 'Top', href: '#top', kind: 'anchor' },
    { text: 'Precios', href: 'http://localhost:4405/demo/otra#nada', kind: 'internal' },
  ];
  hero.components.media = [{ type: 'img', src: 'http://localhost:4405/demo/fondo-PROVISIONAL.png', alt: '' }];
  return scan.pages;
}

function ctx(): IssueContext {
  return {
    linkStatus: new Map([['http://localhost:4405/no-existe', 404], ['http://localhost:4405/demo/otra', 200]]),
    idsByPath: new Map([['/', new Set(['top', 'cotizacion'])], ['/otra', new Set(['precios'])]]),
    pageInfo: new Map([
      ['/', { h1Count: 1, duplicateIds: [] }],
      ['/otra', { h1Count: 2, duplicateIds: ['x'] }],
    ]),
    pathOf: (url) => (url.startsWith('http://localhost:4405/demo/') ? '/' + url.slice('http://localhost:4405/demo/'.length) : null),
  };
}

const rules = (level?: string) =>
  computeIssues(pages(), ctx())
    .filter((i) => !level || i.level === level)
    .map((i) => `${i.rule} ${i.blockKey ?? i.page}`);

describe('computeIssues', () => {
  it('marca enlaces rotos como error', () => {
    expect(rules('error')).toContain('broken-link /#top');
  });
  it('marca anclas inexistentes en la misma página y en otra rastreada', () => {
    const r = rules();
    expect(r.filter((x) => x === 'missing-anchor /#top')).toHaveLength(2);
  });
  it('marca formularios sin destino e imágenes provisionales', () => {
    expect(rules('warn')).toEqual(expect.arrayContaining(['form-no-action /#cotizacion', 'placeholder-image /#top']));
  });
  it('marca bloques sin ancla salvo header, footer y globales', () => {
    const r = rules('info');
    expect(r).toContain('block-no-anchor /~integraciones');
    expect(r.some((x) => x.includes('header') || x.includes('footer'))).toBe(false);
  });
  it('marca h1 múltiples e ids duplicados por página', () => {
    expect(rules()).toEqual(expect.arrayContaining(['heading /otra', 'duplicate-id /otra']));
  });
  it('genera ids estables', () => {
    expect(computeIssues(pages(), ctx()).map((i) => i.id)).toEqual(computeIssues(pages(), ctx()).map((i) => i.id));
  });
});
