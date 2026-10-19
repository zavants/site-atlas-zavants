import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { AddressInfo } from 'node:net';

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.css': 'text/css' };

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Servidor estático para fixtures. `/x` sirve `x.html`; lo inexistente responde 404. */
export async function startStatic(
  dir: string,
  opts: { redirects?: Record<string, string> } = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const target = opts.redirects?.[pathname];
    if (target) {
      res.writeHead(301, { location: target });
      res.end();
      return;
    }
    const rel = normalize(pathname).replace(/^[\\/]+/, '');
    const candidates = [join(dir, rel), join(dir, rel, 'index.html'), join(dir, `${rel}.html`)];
    for (const c of candidates) {
      if (c.startsWith(normalize(dir)) && (await isFile(c))) {
        res.writeHead(200, { 'content-type': types[extname(c)] ?? 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : await readFile(c));
        return;
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
