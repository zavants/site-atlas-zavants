import { timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, realpathSync, watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { en } from '../i18n/en.js';
import { OpError, OverlayOpSchema } from '../model/ops.js';
import { getMap, getPlan, mutate, SiteNotFoundError } from '../model/service.js';
import { runScan } from '../run.js';
import { StaleRevError, type SiteStore } from '../store/store.js';
import { VERSION } from '../version.js';

const SAFE = /^[\w.-]+$/;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

/** The built canvas: next to the compiled server (installed package) or in dist/ (source checkout). */
export function defaultCanvasDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../canvas'), resolve(here, '../../dist/canvas')];
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? candidates[0]!;
}

type SiteEvent = { event: 'overlay' | 'scan' | 'progress'; data: unknown };

/** Vigila la carpeta de cada sitio con clientes conectados y reenvía los cambios (también los de otros procesos). */
class SiteEvents {
  private bus = new EventEmitter();
  private watchers = new Map<string, { watcher: FSWatcher | null; users: number; timer?: NodeJS.Timeout }>();

  constructor(private store: SiteStore) {
    this.bus.setMaxListeners(0);
  }

  emit(site: string, e: SiteEvent) {
    this.bus.emit(site, e);
  }

  subscribe(site: string, fn: (e: SiteEvent) => void): () => void {
    this.bus.on(site, fn);
    let entry = this.watchers.get(site);
    if (!entry) {
      entry = { watcher: null, users: 0 };
      this.watchers.set(site, entry);
      const dir = this.store.dir(site);
      if (existsSync(dir)) {
        const pending = new Set<'overlay' | 'scan'>();
        const current = entry;
        // Ruta larga real: en Windows, vigilar una ruta 8.3 (SEBAST~1) dispara un assert de libuv.
        current.watcher = watch(realpathSync.native(dir), { recursive: true }, (_type, file) => {
          const name = String(file ?? '').replaceAll('\\', '/');
          if (name === 'overlay.json') pending.add('overlay');
          else if (/^scans\/[^/]+\.json$/.test(name)) pending.add('scan');
          else return;
          clearTimeout(current.timer);
          current.timer = setTimeout(() => void this.flush(site, pending), 100);
        });
      }
    }
    entry.users++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.bus.off(site, fn);
      const e = this.watchers.get(site);
      if (e && --e.users === 0) {
        e.watcher?.close();
        clearTimeout(e.timer);
        this.watchers.delete(site);
      }
    };
  }

  private async flush(site: string, pending: Set<'overlay' | 'scan'>) {
    const kinds = [...pending];
    pending.clear();
    for (const kind of kinds) {
      try {
        if (kind === 'overlay') this.emit(site, { event: 'overlay', data: { rev: (await this.store.readOverlay(site)).rev } });
        else this.emit(site, { event: 'scan', data: { scanId: (await this.store.latestScan(site))?.scanId ?? null } });
      } catch {
        // archivo a medio escribir: el siguiente cambio vuelve a avisar
      }
    }
  }

  close() {
    for (const e of this.watchers.values()) {
      e.watcher?.close();
      clearTimeout(e.timer);
    }
    this.watchers.clear();
  }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const isLocalOrigin = (origin: string) => {
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname === '::1' ? '[::1]' : new URL(origin).hostname);
  } catch {
    return false;
  }
};

const OpBody = z.object({ rev: z.number().int().nonnegative(), op: OverlayOpSchema });

export const TOKEN_COOKIE = 'site_atlas_token';

const tokenMatches = (given: string | undefined, token: string): boolean => {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
};

export interface AppOptions {
  canvasDir?: string;
  keepAliveMs?: number;
  /**
   * Shared secret for a canvas reachable from other machines. With a token, every request except
   * /api/health needs `Authorization: Bearer <token>`, or the cookie that `/s/…?token=<token>` sets,
   * and the Host check is dropped (the cookie is bound to the host name, so DNS rebinding gets nothing).
   */
  token?: string;
}

export function createApp(store: SiteStore, opts: AppOptions = {}) {
  const canvasDir = opts.canvasDir ?? defaultCanvasDir();
  const token = opts.token || undefined;
  const events = new SiteEvents(store);
  const rescans = new Set<string>();
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof SiteNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof OpError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: en.http.internal }, 500);
  });

  // Only the canvas itself may use the server.
  // Local mode (default): local Host (against DNS rebinding), local Origin on writes and JSON bodies (against CSRF
  // from any page, including the scanned one).
  // Token mode: a bearer header or the token cookie on every request; a cookie-authenticated write must also be
  // same-origin, since the browser attaches the cookie on its own.
  app.use('*', async (c, next) => {
    if (c.req.path === '/api/health') return next();
    const hostHeader = (c.req.header('host') ?? new URL(c.req.url).host).toLowerCase();
    const host = hostHeader.replace(/:\d+$/, '');
    const read = c.req.method === 'GET' || c.req.method === 'HEAD';
    let viaCookie = false;
    if (token) {
      const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
      if (tokenMatches(bearer, token)) {
        // header auth: nothing a cross-site page can forge
      } else if (tokenMatches(getCookie(c, TOKEN_COOKIE), token)) {
        viaCookie = true;
      } else if (read && tokenMatches(c.req.query('token'), token)) {
        const secure = new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
        setCookie(c, TOKEN_COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/', secure });
        return c.redirect(c.req.path.startsWith('/s/') ? c.req.path : '/s/');
      } else {
        return c.json({ error: en.http.unauthorized }, 401);
      }
    } else if (!LOCAL_HOSTS.has(host)) {
      return c.json({ error: en.http.hostNotAllowed }, 403);
    }
    if (!read) {
      const origin = c.req.header('origin');
      if (!token && origin && !isLocalOrigin(origin)) return c.json({ error: en.http.originNotAllowed }, 403);
      if (viaCookie) {
        const sameOrigin = c.req.header('sec-fetch-site') === 'same-origin' || (origin !== undefined && hostOf(origin) === hostHeader);
        if (!sameOrigin) return c.json({ error: en.http.originNotAllowed }, 403);
      }
      const type = c.req.header('content-type') ?? '';
      if (c.req.path.endsWith('/ops') && !type.startsWith('application/json')) {
        return c.json({ error: en.http.expectedJson }, 415);
      }
    }
    await next();
  });

  app.get('/api/health', (c) => c.json({ app: 'site-atlas', version: VERSION }));
  app.get('/api/sites', async (c) => c.json(await store.listSites()));
  app.get('/api/sites/:site/map', async (c) => c.json(await getMap(store, c.req.param('site'))));
  app.get('/api/sites/:site/plan', async (c) => c.json(await getPlan(store, c.req.param('site'))));

  app.post('/api/sites/:site/ops', async (c) => {
    const site = c.req.param('site');
    const parsed = OpBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: en.http.invalidOp }, 400);
    // Ops over HTTP come from the canvas: a body cannot attribute an edit to an agent.
    const op = 'by' in parsed.data.op ? { ...parsed.data.op, by: 'canvas' } : parsed.data.op;
    try {
      return c.json(await mutate(store, site, op, parsed.data.rev));
    } catch (err) {
      if (err instanceof StaleRevError) {
        return c.json({ error: en.http.mapChanged, map: await getMap(store, site) }, 409);
      }
      throw err;
    }
  });

  app.post('/api/sites/:site/rescan', async (c) => {
    const site = c.req.param('site');
    const scan = await store.latestScan(site);
    if (!scan) throw new SiteNotFoundError(site);
    if (rescans.has(site)) return c.json({ error: en.http.scanRunning }, 409);
    rescans.add(site);
    const { startUrl, ...options } = scan.options ?? { startUrl: scan.environment.origin + scan.environment.basePath };
    void runScan(store, startUrl, { ...options, site, onProgress: (msg) => events.emit(site, { event: 'progress', data: { msg } }) })
      .then(({ scan: s }) => events.emit(site, { event: 'scan', data: { scanId: s.scanId } }))
      .catch((err: Error) => events.emit(site, { event: 'progress', data: { msg: en.scan.failed(err.message) } }))
      .finally(() => rescans.delete(site));
    return c.json({ started: true }, 202);
  });

  app.get('/api/sites/:site/events', (c) => {
    const site = c.req.param('site');
    return streamSSE(c, async (stream) => {
      const queue: SiteEvent[] = [];
      let wake: (() => void) | null = null;
      const off = events.subscribe(site, (e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        off();
        wake?.();
      });
      await stream.writeSSE({ event: 'ready', data: '{}' });
      while (!stream.aborted) {
        const next = queue.shift();
        if (next) {
          await stream.writeSSE({ event: next.event, data: JSON.stringify(next.data) });
          continue;
        }
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, opts.keepAliveMs ?? 15_000);
        });
        wake = null;
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      off();
    });
  });

  app.get('/shots/:site/:scanId/:file', async (c) => {
    const { site, scanId, file } = c.req.param();
    if (![site, scanId, file].every((p) => SAFE.test(p) && !p.includes('..'))) return c.json({ error: en.http.invalidPath }, 400);
    try {
      const data = await readFile(join(store.shotsDir(site, scanId), file));
      return c.body(data, 200, { 'content-type': 'image/webp', 'cache-control': 'max-age=31536000, immutable' });
    } catch {
      return c.json({ error: en.http.notFound }, 404);
    }
  });

  const sendCanvasFile = async (rel: string) => {
    const full = resolve(canvasDir, rel);
    if (!full.startsWith(resolve(canvasDir) + sep)) return null;
    try {
      return { data: await readFile(full), type: TYPES[extname(full)] ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  };
  app.get('/', (c) => c.redirect('/s/'));
  app.get('/s/*', async (c) => {
    const f = await sendCanvasFile('index.html');
    return f ? c.body(f.data, 200, { 'content-type': f.type }) : c.text(en.http.canvasNotBuilt, 503);
  });
  app.get('/assets/*', async (c) => {
    const f = await sendCanvasFile(c.req.path.slice(1));
    return f ? c.body(f.data, 200, { 'content-type': f.type }) : c.notFound();
  });

  return Object.assign(app, { closeEvents: () => events.close() });
}
