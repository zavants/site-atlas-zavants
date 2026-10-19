import { serve, type ServerType } from '@hono/node-server';
import type { SiteStore } from '../store/store.js';
import { createApp } from './http.js';

export const DEFAULT_PORT = 4800;
const LAST_PORT = 4810;

let running: { url: string; close(): Promise<void> } | null = null;

async function probe(port: number): Promise<'site-atlas' | 'other' | 'free'> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    const body = (await res.json().catch(() => null)) as { app?: string } | null;
    return body?.app === 'site-atlas' ? 'site-atlas' : 'other';
  } catch {
    return 'free';
  }
}

function listen(app: ReturnType<typeof createApp>, port: number): Promise<ServerType> {
  return new Promise((resolveListen, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => resolveListen(server));
    server.once('error', reject);
  });
}

/** Arranca (o reutiliza) el servidor local del lienzo. Uno por proceso. */
export async function startCanvasServer(
  store: SiteStore,
  opts: { port?: number } = {},
): Promise<{ url: string; reused: boolean; close(): Promise<void> }> {
  if (running) return { ...running, reused: true };
  const first = opts.port ?? DEFAULT_PORT;
  for (let port = first; port <= Math.max(first, LAST_PORT); port++) {
    const state = await probe(port);
    if (state === 'site-atlas') return { url: `http://127.0.0.1:${port}`, reused: true, close: async () => undefined };
    if (state === 'other') continue;
    const app = createApp(store);
    try {
      const server = await listen(app, port);
      const url = `http://127.0.0.1:${port}`;
      running = {
        url,
        close: () =>
          new Promise<void>((r) => {
            app.closeEvents();
            running = null;
            server.close(() => r());
          }),
      };
      return { ...running, reused: false };
    } catch {
      app.closeEvents();
    }
  }
  throw new Error(`No hay puertos libres entre ${first} y ${LAST_PORT} para el lienzo.`);
}
