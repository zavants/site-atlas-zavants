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
    expect(plan.schemaVersion).toBe(2);
    expect(plan.markdown).toContain('Move "Integraciones"');
    expect(plan.changes).toHaveLength(1);
    const confirm = { type: 'confirmChange', changeId: plan.changes[0].id, note: 'done', by: 'canvas' };
    expect((await post(`/api/sites/${SITE}/ops`, { rev: 1, op: confirm })).status).toBe(400);
  });

  it('attributes canvas ops to the canvas even when the body names an agent', async () => {
    await post(`/api/sites/${SITE}/ops`, { rev: 0, op: { ...move, by: 'claude-code' } });
    const plan = await (await app.request(`/api/sites/${SITE}/plan`)).json();
    expect(plan.changes[0].by).toBe('canvas');
  });
});

describe('API HTTP with a token (canvas reachable from other machines)', () => {
  const TOKEN = 'secret-token-for-tests';
  let guarded: ReturnType<typeof createApp>;
  const bearer = { authorization: `Bearer ${TOKEN}` };
  const cookie = { cookie: `site_atlas_token=${TOKEN}` };
  const opsBody = JSON.stringify({ rev: 0, op: move });

  beforeEach(async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    await store.saveScan(sampleScan());
    guarded = createApp(store, { token: TOKEN });
  });

  it('leaves /api/health open and asks for the token everywhere else', async () => {
    expect((await guarded.request('/api/health')).status).toBe(200);
    const res = await guarded.request(`/api/sites/${SITE}/map`);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/Token required/);
    expect((await guarded.request('/s/')).status).toBe(401);
    expect((await guarded.request(`/api/sites/${SITE}/map`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  });

  it('accepts a bearer token for reads and writes, from any host', async () => {
    expect((await guarded.request(`/api/sites/${SITE}/map`, { headers: { ...bearer, host: 'atlas.example.com:4800' } })).status).toBe(200);
    const res = await guarded.request(`/api/sites/${SITE}/ops`, {
      method: 'POST',
      body: opsBody,
      headers: { ...bearer, 'content-type': 'application/json', host: 'atlas.example.com:4800' },
    });
    expect(res.status).toBe(200);
  });

  it('turns ?token= into an HttpOnly cookie and redirects to the canvas', async () => {
    const res = await guarded.request(`/s/${SITE}?token=${TOKEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/s/${SITE}`);
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain(`site_atlas_token=${TOKEN}`);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    expect((await guarded.request(`/s/${SITE}?token=wrong`)).status).toBe(401);
    expect((await guarded.request(`/api/sites/${SITE}/map`, { headers: cookie })).status).toBe(200);
  });

  it('with the cookie, writes must be same-origin (no CSRF from another page)', async () => {
    const write = (headers: Record<string, string>) =>
      guarded.request(`/api/sites/${SITE}/ops`, { method: 'POST', body: opsBody, headers: { ...cookie, 'content-type': 'application/json', host: 'atlas.example.com', ...headers } });
    expect((await write({})).status).toBe(403);
    expect((await write({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await write({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })).status).toBe(403);
    expect((await write({ 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  });

  it('with the cookie, a write whose Origin matches the Host is same-origin too', async () => {
    const res = await guarded.request(`/api/sites/${SITE}/ops`, {
      method: 'POST',
      body: opsBody,
      headers: { ...cookie, 'content-type': 'application/json', host: 'atlas.example.com:4800', origin: 'http://atlas.example.com:4800' },
    });
    expect(res.status).toBe(200);
  });
});

describe('API HTTP home page', () => {
  it('summarizes every atlas: origin, size, issues and plan progress', async () => {
    await post(`/api/sites/${SITE}/ops`, { rev: 0, op: move });
    const [s] = (await (await app.request('/api/sites')).json()) as Record<string, unknown>[];
    expect(s).toMatchObject({ site: SITE, name: '', pages: 2, pending: 1, applied: 0 });
    expect(s!.origin).toBe('http://localhost:4405/demo/');
    expect(s!.blocks).toBeGreaterThan(2);
    expect(s!.lastScan).toBeTruthy();
  });

  it('validates a new scan request and refuses non-http URLs', async () => {
    const start = (body: unknown) => post('/api/scans', body);
    expect((await start({})).status).toBe(400);
    expect((await start({ url: 'ftp://example.com' })).status).toBe(400);
    expect((await start({ url: 'not a url' })).status).toBe(400);
    expect((await start({ url: 'http://localhost:1/', site: '../etc' })).status).toBe(400);
    expect((await start({ url: 'http://localhost:1/', maxPages: 0 })).status).toBe(400);
    const res = await app.request('/api/scans', { method: 'POST', body: JSON.stringify({ url: 'http://localhost:1/' }), headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
  });

  it('renames an atlas (display name, same id) and rejects an empty body', async () => {
    const patch = (body: unknown) => app.request(`/api/sites/${SITE}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    expect((await patch({ name: 'Demo site' })).status).toBe(200);
    const [s] = (await (await app.request('/api/sites')).json()) as { site: string; name: string }[];
    expect(s).toMatchObject({ site: SITE, name: 'Demo site' });
    expect((await patch({})).status).toBe(400);
    expect((await app.request('/api/sites/nada', { method: 'PATCH', body: JSON.stringify({ name: 'x' }), headers: { 'content-type': 'application/json' } })).status).toBe(404);
  });

  it('deletes an atlas and then no longer lists it', async () => {
    expect((await app.request(`/api/sites/${SITE}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await app.request('/api/sites')).json()).toEqual([]);
    expect((await app.request(`/api/sites/${SITE}`, { method: 'DELETE' })).status).toBe(404);
    expect((await app.request('/api/sites/..%2F..', { method: 'DELETE' })).status).toBe(400);
  });
});

describe('API HTTP advice', () => {
  const put = (body: unknown, type = 'application/json') =>
    app.request(`/api/sites/${SITE}/advice`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': type } });

  it('stores and returns advice, with by from the body and the mode on the site', async () => {
    expect((await app.request(`/api/sites/${SITE}/advice`)).status).toBe(404);
    const res = await put({ by: 'claude-code', summary: 'Move pricing up', markdown: '# Advice', mode: 'own' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ by: 'claude-code', summary: 'Move pricing up', markdown: '# Advice' });
    expect(await (await app.request(`/api/sites/${SITE}/advice`)).json()).toMatchObject({ by: 'claude-code' });
    const [s] = (await (await app.request('/api/sites')).json()) as { mode: string; advice: { summary: string } }[];
    expect(s).toMatchObject({ mode: 'own', advice: { summary: 'Move pricing up' } });
  });

  it('rejects bad advice bodies and unknown sites', async () => {
    expect((await put({ by: 'x', summary: 'a'.repeat(201), markdown: '' })).status).toBe(400);
    expect((await put({ by: 'x', summary: 's', markdown: 'm', mode: 'maybe' })).status).toBe(400);
    expect((await put({ by: 'x', summary: 's', markdown: 'm' }, 'text/plain')).status).toBe(415);
    expect(
      (
        await app.request('/api/sites/nada/advice', {
          method: 'PUT',
          body: JSON.stringify({ by: 'x', summary: 's', markdown: 'm' }),
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(404);
  });

  it('PATCH sets the mode next to the name and validates it', async () => {
    const patch = (body: unknown) => app.request(`/api/sites/${SITE}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    expect(await (await patch({ mode: 'advisory' })).json()).toMatchObject({ mode: 'advisory' });
    expect(await (await patch({ mode: null })).json()).toMatchObject({ mode: null });
    expect((await patch({ mode: 'maybe' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });
});
