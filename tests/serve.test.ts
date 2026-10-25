import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLoopback, startCanvasServer } from '../src/server/serve.js';
import { SiteStore } from '../src/store/store.js';

describe('canvas server binding', () => {
  it('knows which hosts are loopback', () => {
    for (const h of ['127.0.0.1', 'localhost', '::1', '[::1]', 'LOCALHOST']) expect(isLoopback(h)).toBe(true);
    for (const h of ['0.0.0.0', '::', '192.168.1.10', 'atlas.example.com']) expect(isLoopback(h)).toBe(false);
  });

  it('a non-loopback bind gets a generated token and guards the API with it', async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    const server = await startCanvasServer(store, { host: '0.0.0.0', port: 4830 });
    try {
      expect(server.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(server.url).not.toContain('0.0.0.0');
      // the bind is on every interface, so loopback reaches it too
      expect((await fetch('http://127.0.0.1:4830/api/health')).status).toBe(200);
      expect((await fetch('http://127.0.0.1:4830/api/sites')).status).toBe(401);
      expect((await fetch('http://127.0.0.1:4830/api/sites', { headers: { authorization: `Bearer ${server.token}` } })).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('a non-loopback bind keeps a given token and does not walk to other ports', async () => {
    const store = new SiteStore(await mkdtemp(join(tmpdir(), 'site-atlas-test-')));
    const first = await startCanvasServer(store, { host: '0.0.0.0', port: 4831, token: 'given' });
    try {
      expect(first.token).toBe('given');
    } finally {
      await first.close();
    }
  });
});
