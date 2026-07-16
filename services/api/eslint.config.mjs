import { base } from '@zios/config/eslint';
import noCrossModuleInternals from './eslint-rules/no-cross-module-internals.mjs';

export default [
  ...base,
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
