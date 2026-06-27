import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'src/lib/**/*.ts'],
      // Out of scope for unit tests: process wiring/entry, runtime loops driven
      // by rAF/WebSocket, three.js mesh construction, and static asset data —
      // these are exercised by the live/preview verification, not unit tests
      // (same rationale as excluding src/components).
      exclude: [
        'server/index.ts',
        'server/process-names.ts',
        'src/lib/demo.ts',
        'src/lib/live.ts',
        'src/lib/anim.ts',
        'src/lib/globe-meshes.ts',
        'src/lib/icons.ts',
        'src/lib/view-refs.ts',
      ],
      reporter: ['text-summary'],
    },
  },
});
