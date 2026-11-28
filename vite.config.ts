import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const target = 'http://localhost:3000';

/** The chunk of a module in the production build; `null` leaves it in the entry chunk (app shell, components, shared). */
function chunkName(id: string): string | null {
  // The 3D cave view and three.js load only when a cave is opened in 3D (a dynamic import), so they get chunks of
  // their own instead of joining the feature's and the libraries' chunks the map loads at start.
  if (/[\\/]node_modules[\\/]three[\\/]build[\\/]/.test(id)) return 'three';
  if (/[\\/]node_modules[\\/]three[\\/]/.test(id) || /[\\/]features[\\/]caves[\\/]CaveViewer3d\.tsx$/.test(id)) return 'cave-viewer';
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return 'react';
  if (/[\\/]node_modules[\\/](leaflet|react-leaflet|@react-leaflet[\\/][^\\/]+)[\\/]/.test(id)) return 'leaflet';
  if (/[\\/]node_modules[\\/]/.test(id)) return 'vendor';
  const feature = /[\\/]src[\\/]web[\\/]features[\\/]([^\\/]+)[\\/]/.exec(id);
  return feature ? `feature-${feature[1]}` : null;
}

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  // The product version (bumped by hand in package.json), shown as "ficsmap vX.Y.Z".
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // three.js alone is about 570 kB and cannot be split further; it loads only with the 3D cave view. Every chunk the
    // map loads at start stays far below this.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // One chunk per library family and per feature instead of one 1.5 MB bundle: the map needs nearly all of it
        // at start, so lazy pages would save little, but a release only changes the chunks of what changed.
        codeSplitting: { includeDependenciesRecursively: false, groups: [{ name: chunkName }] },
        // The features import each other, so their chunks do too; keep the modules' own execution order across them.
        strictExecutionOrder: true,
      },
    },
  },
  server: {
    host: true, // listen on all interfaces so LAN devices can connect
    proxy: {
      '/api': target,
      '/auth': target,
      '/invite': target,
      '/data': target,
      '/healthz': target,
      // The maintenance page and its owner sign-in (the banner's "Details" in maintenance mode).
      '/maintenance': target,
    },
  },
  worker: { format: 'es' },
});
