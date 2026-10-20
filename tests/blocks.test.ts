import { describe, expect, it } from 'vitest';
import { blockKeys, blockName, fingerprint, inferKind, similarity, type RawBlock } from '../src/scan/blocks.js';

function raw(partial: Partial<RawBlock> = {}): RawBlock {
  return {
    tag: 'section',
    atlasName: null,
    ariaLabel: null,
    kicker: null,
    heading: null,
    anchor: null,
    height: 400,
    text: '',
    childTags: [],
    hasForm: false,
    landmark: false,
    visualRatio: 0,
    components: { headings: [], links: [], buttons: [], forms: [], media: [] },
    ...partial,
  };
}

describe('blockName', () => {
  it('prefiere aria-label sobre el antetítulo', () => {
    expect(blockName(raw({ ariaLabel: 'Impacto', kicker: 'Otro' }), 1)).toBe('Impacto');
  });
  it('prefiere el antetítulo sobre el título', () => {
    expect(blockName(raw({ kicker: 'Productos', heading: 'Decenas de módulos.' }), 1)).toBe('Productos');
  });
  it('usa data-atlas-block antes que todo', () => {
    expect(blockName(raw({ atlasName: 'Marcado', ariaLabel: 'Impacto' }), 1)).toBe('Marcado');
  });
  it('nombra header y footer sin datos', () => {
    expect(blockName(raw({ tag: 'header' }), 1)).toBe('Header');
    expect(blockName(raw({ tag: 'footer' }), 9)).toBe('Footer');
  });
  it('acorta nombres largos a 60 caracteres', () => {
    const name = blockName(raw({ heading: 'Infraestructura financiera para aumentar sus ingresos. Acepte pagos y ofrezca servicios.' }), 1);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith('…')).toBe(true);
  });
  it('usa etiqueta y ordinal como último recurso', () => {
    expect(blockName(raw({ tag: 'div' }), 3)).toBe('div 3');
  });
});

describe('inferKind', () => {
  it('formulario gana a todo', () => {
    expect(inferKind(raw({ hasForm: true, visualRatio: 0.9 }))).toBe('conversion');
  });
  it('visual desde 30 % de área', () => {
    expect(inferKind(raw({ visualRatio: 0.3 }))).toBe('visual');
    expect(inferKind(raw({ visualRatio: 0.29 }))).toBe('narrative');
  });
});

describe('blockKeys', () => {
  it('usa ancla o slug y numera slugs repetidos', () => {
    expect(
      blockKeys('/', [
        { name: 'Cómo trabajamos', anchor: null },
        { name: 'Precios', anchor: 'precios' },
        { name: 'Cómo trabajamos', anchor: null },
      ]),
    ).toEqual(['/~como-trabajamos', '/#precios', '/~como-trabajamos-2']);
  });
});

describe('blockKeys con ids repetidos', () => {
  it('numera anclas repetidas', () => {
    expect(blockKeys('/', [{ name: 'A', anchor: 'x' }, { name: 'B', anchor: 'x' }])).toEqual(['/#x', '/#x-2']);
  });
});

describe('fingerprint', () => {
  it('ignora espacios y mayúsculas', () => {
    const a = raw({ heading: 'Hola  Mundo', text: 'Texto  largo', childTags: ['h2', 'p'] });
    const b = raw({ heading: 'hola mundo', text: ' texto largo ', childTags: ['h2', 'p'] });
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).toHaveLength(12);
  });
  it('cambia si cambia la estructura', () => {
    const a = raw({ heading: 'x', childTags: ['h2', 'p'] });
    expect(fingerprint(a)).not.toBe(fingerprint({ ...a, childTags: ['h2', 'div'] }));
  });
});

describe('similarity', () => {
  it('compara por bigramas', () => {
    expect(similarity('hola mundo', 'hola mundo')).toBe(1);
    expect(similarity('', '')).toBe(0);
    const base = 'Integración nativa con la infraestructura estándar de la industria financiera global';
    const s = similarity(base, base.replace('global', 'moderna'));
    expect(s).toBeGreaterThanOrEqual(0.8);
    expect(s).toBeLessThan(1);
  });
});
