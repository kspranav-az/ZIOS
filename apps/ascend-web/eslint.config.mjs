import { base } from '@zios/config/eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// Browser app: DOM globals + react-hooks rules on top of the shared preset.
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    ignores: ['playwright-report/**', 'test-results/**'],
  },
];
