import { base } from '@zios/config/eslint';

// Root config: lints only repo-level tooling files. Each workspace package has
// its own eslint.config.mjs built on the same preset and is linted via
// `pnpm -r lint`.
export default [
  ...base,
  {
    ignores: [
      'apps/**',
      'services/**',
      'packages/**',
      'infra/**',
      'docs/**',
      'phases/**',
      'AI-Interview-Platform/**',
    ],
  },
];
