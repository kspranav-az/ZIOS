import { base } from '@zios/config/eslint';
import noCrossModuleInternals from './eslint-rules/no-cross-module-internals.mjs';

export default [
  ...base,
  {
    rules: {
      // Allow intentional unused parameters (typed mocks, interface conformance).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/modules/**/*.ts'],
    plugins: {
      zios: {
        rules: {
          'no-cross-module-internals': noCrossModuleInternals,
        },
      },
    },
    rules: {
      'zios/no-cross-module-internals': 'error',
    },
  },
];
