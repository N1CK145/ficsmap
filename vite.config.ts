import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const target = 'http://localhost:3000';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  // The product version (bumped by hand in package.json), shown as "ficsmap vX.Y.Z".
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    host: true, // listen on all interfaces so LAN devices can connect
    proxy: {
      '/api': target,
      '/auth': target,
      '/invite': target,
      '/data': target,
      '/healthz': target,
    },
  },
  worker: { format: 'es' },
});
