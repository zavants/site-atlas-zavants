import type { Block, Components, Scan } from '../../src/schema/scan.js';

const noComponents = (): Components => ({ headings: [], links: [], buttons: [], forms: [], media: [] });

function block(partial: Partial<Block> & Pick<Block, 'key' | 'name' | 'order'>): Block {
  return {
    heading: null,
    anchor: null,
    tag: 'section',
    height: 400,
    kind: 'narrativa',
    global: false,
    fingerprint: `fp-${partial.key}`,
    textExcerpt: `Texto de ${partial.name}`,
    components: noComponents(),
    shot: null,
    ...partial,
  };
}

/** Escaneo de ejemplo: dos páginas que comparten header y footer. */
export function sampleScan(overrides: Partial<Scan> & { heroName?: string } = {}): Scan {
  const { heroName, ...rest } = overrides;
  const header = (order: number) =>
    block({ key: '/~header', name: 'Header', order, tag: 'header', global: true, fingerprint: 'fp-header', height: 80 });
  const footer = (path: string, order: number) =>
    block({ key: `${path}~footer`, name: 'Footer', order, tag: 'footer', global: true, fingerprint: 'fp-footer', height: 120 });
  return {
    schemaVersion: 1,
    scanId: '2026-10-19T10-00-00.000Z',
    site: 'localhost-4405-demo',
    environment: { origin: 'http://localhost:4405', basePath: '/demo/' },
    startedAt: '2026-10-19T10:00:00.000Z',
    finishedAt: '2026-10-19T10:00:05.000Z',
    pages: [
      {
        path: '/',
        url: 'http://localhost:4405/demo/',
        title: 'Inicio',
        status: 200,
        error: null,
        blocks: [
          header(0),
          block({ key: '/#top', name: heroName ?? 'Hero', order: 1, anchor: 'top', kind: 'visual', heading: 'Bienvenidos' }),
          block({ key: '/~integraciones', name: 'Integraciones', order: 2, textExcerpt: 'Integración nativa con la infraestructura estándar de la industria' }),
          block({
            key: '/#cotizacion',
            name: 'Cierre',
            order: 3,
            anchor: 'cotizacion',
            kind: 'conversion',
            components: { ...noComponents(), forms: [{ fields: 5, action: null, method: 'get' }] },
          }),
          footer('/', 4),
        ],
      },
      {
        path: '/otra',
        url: 'http://localhost:4405/demo/otra',
        title: 'Otra',
        status: 200,
        error: null,
        blocks: [
          { ...header(0), key: '/otra~header' },
          block({ key: '/otra#precios', name: 'Precios', order: 1, anchor: 'precios' }),
          footer('/otra', 2),
        ],
      },
    ],
    missingPages: [],
    issues: [
      { id: 'i1', level: 'error', rule: 'broken-link', page: '/', blockKey: '/#top', message: 'Enlace roto a /no-existe' },
      { id: 'i2', level: 'warn', rule: 'form-no-action', page: '/', blockKey: '/#cotizacion', message: 'Formulario sin destino' },
      { id: 'i3', level: 'info', rule: 'block-no-anchor', page: '/', blockKey: '/~integraciones', message: 'Bloque sin ancla' },
    ],
    ...rest,
  };
}
