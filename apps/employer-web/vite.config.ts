import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @zios/shared-types is a workspace-linked CJS package. Linked deps are
  // excluded from pre-bundling by default, which breaks rollup on the first
  // VALUE import (type-only imports are erased). Force it through esbuild's
  // CJS→ESM interop so named runtime exports (e.g. OVERRIDE_REASON_CODES)
  // resolve in production builds.
  optimizeDeps: {
    include: ['@zios/shared-types'],
  },
  build: {
    commonjsOptions: {
      include: [/shared-types/, /node_modules/],
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
});
