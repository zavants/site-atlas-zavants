import { EventEmitter } from 'node:events';
import { existsSync, realpathSync, watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
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

function defaultCanvasDir(): string {
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
    return () => {
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

const OpBody = z.object({ rev: z.number().int().nonnegative(), op: OverlayOpSchema });

export function createApp(store: SiteStore, opts: { canvasDir?: string } = {}) {
  const canvasDir = opts.canvasDir ?? defaultCanvasDir();
  const events = new SiteEvents(store);
  const rescans = new Set<string>();
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof SiteNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof OpError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: 'Error interno del servidor.' }, 500);
  });

  app.get('/api/health', (c) => c.json({ app: 'site-atlas', version: VERSION }));
  app.get('/api/sites', async (c) => c.json(await store.listSites()));
  app.get('/api/sites/:site/map', async (c) => c.json(await getMap(store, c.req.param('site'))));
  app.get('/api/sites/:site/plan', async (c) => c.json(await getPlan(store, c.req.param('site'))));

  app.post('/api/sites/:site/ops', async (c) => {
    const site = c.req.param('site');
    const parsed = OpBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Operación inválida.' }, 400);
    try {
      return c.json(await mutate(store, site, parsed.data.op, parsed.data.rev));
    } catch (err) {
      if (err instanceof StaleRevError) {
        return c.json({ error: 'El mapa cambió mientras editabas; se recargó.', map: await getMap(store, site) }, 409);
      }
      throw err;
    }
  });

  app.post('/api/sites/:site/rescan', async (c) => {
    const site = c.req.param('site');
    const scan = await store.latestScan(site);
    if (!scan) throw new SiteNotFoundError(site);
    if (rescans.has(site)) return c.json({ error: 'Ya hay un escaneo en curso.' }, 409);
    rescans.add(site);
    const url = scan.environment.origin + scan.environment.basePath;
    void runScan(store, url, { site, onProgress: (msg) => events.emit(site, { event: 'progress', data: { msg } }) })
      .then(({ scan: s }) => events.emit(site, { event: 'scan', data: { scanId: s.scanId } }))
      .catch((err: Error) => events.emit(site, { event: 'progress', data: { msg: `El escaneo falló: ${err.message}` } }))
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
      stream.onAbort(off);
      await stream.writeSSE({ event: 'ready', data: '{}' });
      while (!stream.aborted) {
        const next = queue.shift();
        if (next) {
          await stream.writeSSE({ event: next.event, data: JSON.stringify(next.data) });
          continue;
        }
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 15_000);
        });
        wake = null;
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      off();
    });
  });

  app.get('/shots/:site/:scanId/:file', async (c) => {
    const { site, scanId, file } = c.req.param();
    if (![site, scanId, file].every((p) => SAFE.test(p) && !p.includes('..'))) return c.json({ error: 'Ruta inválida.' }, 400);
    try {
      const data = await readFile(join(store.shotsDir(site, scanId), file));
      return c.body(data, 200, { 'content-type': 'image/webp', 'cache-control': 'max-age=31536000, immutable' });
    } catch {
      return c.json({ error: 'No encontrada.' }, 404);
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
    return f ? c.body(f.data, 200, { 'content-type': f.type }) : c.text('Lienzo no compilado: ejecuta pnpm build.', 503);
  });
  app.get('/assets/*', async (c) => {
    const f = await sendCanvasFile(c.req.path.slice(1));
    return f ? c.body(f.data, 200, { 'content-type': f.type }) : c.notFound();
  });

  return Object.assign(app, { closeEvents: () => events.close() });
}
