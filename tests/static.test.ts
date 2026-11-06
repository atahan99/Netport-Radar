import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { indexDist, resolveStatic } from '../server/static';

let root: string;
let files: Map<string, string>;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'netport-static-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<html>');
  writeFileSync(join(root, 'assets', 'app.js'), '');
  symlinkSync('/etc/hosts', join(root, 'assets', 'link.txt'));
  files = indexDist(root);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolveStatic', () => {
  it('serves files inside the root and falls back to index.html', () => {
    expect(resolveStatic(files, '/assets/app.js?v=1')).toBe(join(root, 'assets', 'app.js'));
    expect(resolveStatic(files, '/')).toBe(join(root, 'index.html'));
    expect(resolveStatic(files, '/assets/')).toBe(join(root, 'index.html'));
    expect(resolveStatic(files, '/no/such/route')).toBe(join(root, 'index.html'));
  });

  it('never serves anything outside the listed files', () => {
    const index = join(root, 'index.html');
    expect(files.has('/assets/link.txt')).toBe(false); // symlink skipped
    for (const url of [
      '/../../../../etc/passwd',
      '/assets/../../etc/passwd',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2fetc%2fpasswd',
      '/assets/link.txt',
    ]) {
      expect(resolveStatic(files, url), url).toBe(index);
    }
    expect(resolveStatic(files, '/%00')).toBeNull();
    expect(resolveStatic(files, '/%E0%A4%A')).toBeNull(); // malformed encoding
  });
});
