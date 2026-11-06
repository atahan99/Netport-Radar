// server/static.ts
// Minimal static server for the built UI (SERVE_DIST=1). Request paths are
// untrusted: with NETPORT_BIND=0.0.0.0 any LAN device can reach this, so only
// files listed from dist/ at startup are ever served.

import http from 'http';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { extname, join } from 'path';

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

// Every regular file under `root`, keyed by its URL path ('/assets/app.js').
// Built once at startup, so a request path is only ever a map key and never
// reaches the filesystem. Symlinks are skipped (Dirent.isFile() is false).
export function indexDist(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs, `${prefix}${e.name}/`);
      else if (e.isFile()) files.set(`${prefix}${e.name}`, abs);
    }
  };
  walk(root, '/');
  return files;
}

// Map a request URL to a file from indexDist, or null for a malformed URL.
// Unknown paths (including any '..' attempt) fall back to index.html (SPA).
export function resolveStatic(files: Map<string, string>, url: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(url.split('?')[0].split('#')[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  if (rel.includes('\0')) return null;
  return files.get(rel.startsWith('/') ? rel : `/${rel}`) ?? files.get('/index.html') ?? null;
}

export function serveDist(root: string, port: number, host: string): void {
  if (!existsSync(root)) {
    console.warn('[serve] dist/ not found — run `npm run build` first');
    return;
  }
  const files = indexDist(root);
  http
    .createServer((req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const file = resolveStatic(files, req.url ?? '/');
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
