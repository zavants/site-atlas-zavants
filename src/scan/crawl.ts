/** Absoluta, sin fragmento ni query, sin `index.html` final; `null` si no es http(s). */
export function normalizeUrl(href: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.search = '';
  u.pathname = u.pathname.replace(/\/index\.html?$/i, '/');
  return u.toString();
}

export function inScope(url: string, env: { origin: string; basePath: string }): boolean {
  const u = new URL(url);
  return u.origin === env.origin && (u.pathname.startsWith(env.basePath) || `${u.pathname}/` === env.basePath);
}

export function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.test');
}
