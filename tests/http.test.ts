import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/http.js';
import { SiteStore } from '../src/store/store.js';
import { sampleScan } from './helpers/sample.js';

const SITE = 'localhost-4405-demo';
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
  await store.saveScan(sampleScan());
  app = createApp(store);
});

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const move = { type: 'moveBlock', blockKey: '/~integraciones', toPage: '/otra', index: 0 };

describe('API HTTP', () => {
  it('identifica la app', async () => {
    expect(await (await app.request('/api/health')).json()).toMatchObject({ app: 'site-atlas' });
  });

  it('devuelve el mapa del sitio', async () => {
    const res = await app.request(`/api/sites/${SITE}/map`);
    expect(res.status).toBe(200);
    const map = await res.json();
    expect(map.pages).toHaveLength(2);
    expect(map.globals).toHaveLength(2);
    expect((await app.request('/api/sites/nada/map')).status).toBe(404);
  });

  it('aplica operaciones y rechaza rev desactualizado con el mapa actual', async () => {
    const ok = await post(`/api/sites/${SITE}/ops`, { rev: 0, op: move });
    expect(ok.status).toBe(200);
    expect((await ok.json()).rev).toBe(1);
    const stale = await post(`/api/sites/${SITE}/ops`, { rev: 0, op: { ...move, index: 1 } });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.map.rev).toBe(1);
    expect(body.error).toMatch(/changed/);
  });

  it('responde 400 con English message ante operaciones inválidas', async () => {
    const bad = await post(`/api/sites/${SITE}/ops`, { rev: 0, op: { type: 'markDeleted', blockKey: '/#nada' } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/No section/);
    expect((await post(`/api/sites/${SITE}/ops`, { rev: 0, op: { type: 'volar' } })).status).toBe(400);
  });

  it('no permite salir de la carpeta de miniaturas', async () => {
    expect((await app.request(`/shots/${SITE}/..%2F..%2Fetc/passwd.webp`)).status).toBe(400);
  });

  it('rechaza cuerpos que no son JSON', async () => {
    const res = await app.request(`/api/sites/${SITE}/ops`, { method: 'POST', body: JSON.stringify({ rev: 0, op: move }), headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
  });

  it('rechaza peticiones de otros orígenes', async () => {
    const res = await app.request(`/api/sites/${SITE}/ops`, {
      method: 'POST',
      body: JSON.stringify({ rev: 0, op: move }),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('rechaza un Host ajeno (DNS rebinding)', async () => {
    expect((await app.request(`/api/sites/${SITE}/map`, { headers: { host: 'attacker.example:4800' } })).status).toBe(403);
    expect((await app.request(`/api/sites/${SITE}/map`, { headers: { host: '127.0.0.1:4800' } })).status).toBe(200);
  });

  it('describe el plan', async () => {
    await post(`/api/sites/${SITE}/ops`, { rev: 0, op: move });
    const plan = await (await app.request(`/api/sites/${SITE}/plan`)).json();
    expect(plan.text).toContain('Move "Integraciones"');
    expect(plan.diffs).toHaveLength(1);
  });
});
