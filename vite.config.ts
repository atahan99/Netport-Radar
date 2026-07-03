import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    // Both heavy renderers are lazy-loaded views; their chunks are expected to
    // be large, so only warn past 2 MB.
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        // Keep the heavy renderer deps in their own named chunks so the entry
        // stays small and each is fetched only when its view is opened. Groups
        // include their transitive deps (the default) — excluding them proved
        // non-deterministic and could break cross-chunk class inheritance
        // ("Super expression must either be null or a function").
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/ },
            { name: 'three', test: /node_modules[\\/](three|three-globe|react-globe\.gl)[\\/]/ },
          ],
        },
      },
    },
  },
})
