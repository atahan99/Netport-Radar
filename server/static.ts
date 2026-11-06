// server/static.ts
// Minimal static server for the built UI (SERVE_DIST=1). Request paths are
// untrusted: with NETPORT_BIND=0.0.0.0 any LAN device can reach this, so every
// path must resolve inside dist/ or it gets a 404.

import http from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, resolve, sep } from 'path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

// Map a request URL to a file under `root`, or null if it escapes `root`.
// Unknown paths fall back to index.html (single-page app).
export function resolveStatic(root: string, url: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(url.split('?')[0].split('#')[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  if (rel.includes('\0')) return null;
  const base = resolve(root);
  const file = resolve(base, '.' + (rel.startsWith('/') ? rel : `/${rel}`));
  if (file !== base && !file.startsWith(base + sep)) return null;
  if (file === base || !existsSync(file) || !statSync(file).isFile()) {
    return resolve(base, 'index.html');
  }
  return file;
}

export function serveDist(root: string, port: number, host: string): void {
  if (!existsSync(root)) {
    console.warn('[serve] dist/ not found — run `npm run build` first');
    return;
  }
  http
    .createServer((req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const file = resolveStatic(root, req.url ?? '/');
      if (!file) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      try {
        const data = readFileSync(file);
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        res.end(data);
      } catch {
        res.statusCode = 404;
        res.end('not found');
      }
    })
    .listen(port, host, () =>
      console.log(`[serve] dist on http://localhost:${port} (bound ${host})`),
    );
}
