import { homedir } from 'node:os';
import { join } from 'node:path';

export function atlasHome(): string {
  return process.env.SITE_ATLAS_HOME ?? join(homedir(), '.site-atlas');
}

export function siteDir(site: string, home = atlasHome()): string {
  return join(home, 'sites', site);
}

/** host + puerto + primer segmento de ruta, en minúsculas y separados por `-`. */
export function deriveSiteId(url: string): string {
  const u = new URL(url);
  const firstSegment = u.pathname.split('/').filter(Boolean)[0];
  const parts = [u.hostname.replace(/^www\./, ''), u.port, firstSegment?.includes('.') ? undefined : firstSegment];
  return parts
    .filter((p): p is string => Boolean(p))
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Normaliza una ruta de página relativa a la ruta base del entorno. */
export function pagePath(pathname: string, basePath: string): string {
  let rest = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname.replace(/^\//, '');
  rest = rest.replace(/(^|\/)index\.html?$/i, '$1').replace(/\/+$/, '');
  return '/' + rest;
}

export function splitEnvironment(url: string): { origin: string; basePath: string; path: string } {
  const u = new URL(url);
  const basePath = u.pathname.endsWith('/') ? u.pathname : u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
  return { origin: u.origin, basePath, path: pagePath(u.pathname, basePath) };
}
