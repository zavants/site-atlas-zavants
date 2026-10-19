import { describe, expect, it } from 'vitest';
import { inScope, isLocalHost, normalizeUrl } from '../src/scan/crawl.js';

describe('normalizeUrl', () => {
  it('quita query y fragmento', () => {
    expect(normalizeUrl('/a/?x=1#y', 'http://h:1/b/')).toBe('http://h:1/a/');
  });
  it('trata index.html y la carpeta como la misma página', () => {
    expect(normalizeUrl('index.html', 'http://h:1/b/')).toBe(normalizeUrl('./', 'http://h:1/b/'));
  });
  it('descarta esquemas que no son http', () => {
    expect(normalizeUrl('mailto:a@b.c', 'http://h:1/')).toBeNull();
    expect(normalizeUrl('javascript:void(0)', 'http://h:1/')).toBeNull();
  });
});

describe('inScope', () => {
  const env = { origin: 'http://h:1', basePath: '/b/' };
  it('acepta rutas bajo la ruta base del mismo origen', () => {
    expect(inScope('http://h:1/b/otra', env)).toBe(true);
  });
  it('rechaza otro origen y rutas fuera de la base', () => {
    expect(inScope('http://otro:1/b/x', env)).toBe(false);
    expect(inScope('http://h:1/c/x', env)).toBe(false);
  });
});

describe('isLocalHost', () => {
  it('reconoce hosts de desarrollo', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', '[::1]', 'app.localhost', 'app.test']) expect(isLocalHost(h)).toBe(true);
    expect(isLocalHost('stripe.com')).toBe(false);
  });
});
