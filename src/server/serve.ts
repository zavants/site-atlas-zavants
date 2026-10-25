import { serve, type ServerType } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { en } from '../i18n/en.js';
import type { SiteStore } from '../store/store.js';
import { createApp } from './http.js';

export const DEFAULT_PORT = 4800;
export const DEFAULT_HOST = '127.0.0.1';
const LAST_PORT = 4810;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const WILDCARD = new Set(['0.0.0.0', '::', '[::]']);

export interface CanvasServerOptions {
  port?: number;
  /** Interface to listen on. Anything but loopback needs a token; one is generated when missing. */
  host?: string;
  token?: string;
}

export interface CanvasServer {
  url: string;
  /** Set when the server needs a token (see `createApp`). */
  token?: string;
  reused: boolean;
  close(): Promise<void>;
}

export const isLoopback = (host: string): boolean => LOOPBACK.has(host.toLowerCase());

/** A host name that browsers on other machines can use: the first external IPv4 for a wildcard bind. */
function displayHost(host: string): string {
  if (!WILDCARD.has(host)) return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  for (const list of Object.values(networkInterfaces())) {
    const v4 = list?.find((i) => i.family === 'IPv4' && !i.internal);
    if (v4) return v4.address;
  }
  return hostname();
}

let running: CanvasServer | null = null;

async function probe(port: number): Promise<'site-atlas' | 'other' | 'free'> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    const body = (await res.json().catch(() => null)) as { app?: string } | null;
    return body?.app === 'site-atlas' ? 'site-atlas' : 'other';
  } catch {
    return 'free';
  }
}

function listen(app: ReturnType<typeof createApp>, port: number, host: string): Promise<ServerType> {
  return new Promise((resolveListen, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: host }, () => resolveListen(server));
    server.once('error', reject);
  });
}

/**
 * Starts (or reuses) the canvas server. One per process.
 * Loopback (default): walks ports 4800-4810 and reuses an Atlas already listening there.
 * Any other host: listens on exactly the given port and requires a token.
 */
export async function startCanvasServer(store: SiteStore, opts: CanvasServerOptions = {}): Promise<CanvasServer> {
  if (running) return { ...running, reused: true };
  const host = opts.host ?? DEFAULT_HOST;
  const local = isLoopback(host);
  const token = opts.token || (local ? undefined : randomBytes(24).toString('base64url'));
  const first = opts.port ?? DEFAULT_PORT;
  const last = local ? Math.max(first, LAST_PORT) : first;
  for (let port = first; port <= last; port++) {
    if (local) {
      const state = await probe(port);
      if (state === 'site-atlas') return { url: `http://127.0.0.1:${port}`, reused: true, close: async () => undefined };
      if (state === 'other') continue;
    }
    const app = createApp(store, { token });
    try {
      const server = await listen(app, port, host);
      const url = `http://${local ? '127.0.0.1' : displayHost(host)}:${port}`;
      running = {
        url,
        token,
        reused: false,
        close: () =>
          new Promise<void>((r) => {
            app.closeEvents();
            running = null;
            server.close(() => r());
          }),
      };
      return running;
    } catch (err) {
      app.closeEvents();
      if (!local) throw new Error(en.http.cannotListen(host, port, (err as Error).message));
    }
  }
  throw new Error(en.http.noFreePort(first, LAST_PORT));
}
