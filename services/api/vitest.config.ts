import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild does not emit decorator metadata, which NestJS DI needs at app
  // boot; SWC does (legacy decorators + decoratorMetadata, like tsc).
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
      module: { type: 'es6' },
      sourceMaps: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Integration suites boot Nest and hit real Postgres/Mailpit.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
