import { base } from '@zios/config/eslint';
import globals from 'globals';

// Browser-side component library: DOM globals on top of the shared preset.
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];
