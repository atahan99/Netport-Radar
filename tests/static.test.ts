import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveStatic } from '../server/static';

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'netport-static-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<html>');
  writeFileSync(join(root, 'assets', 'app.js'), '');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolveStatic', () => {
  it('serves files inside the root and falls back to index.html', () => {
    expect(resolveStatic(root, '/assets/app.js?v=1')).toBe(join(root, 'assets', 'app.js'));
    expect(resolveStatic(root, '/')).toBe(join(root, 'index.html'));
    expect(resolveStatic(root, '/assets/')).toBe(join(root, 'index.html'));
    expect(resolveStatic(root, '/no/such/route')).toBe(join(root, 'index.html'));
  });

  it('rejects paths that escape the root', () => {
    for (const url of [
      '/../../../../etc/passwd',
      '/assets/../../etc/passwd',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2fetc%2fpasswd',
      '/%00',
      '/%E0%A4%A', // malformed encoding
    ]) {
      expect(resolveStatic(root, url), url).toBeNull();
    }
  });
});
