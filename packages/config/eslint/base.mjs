import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared ESLint flat-config preset for every TypeScript/JavaScript package in
 * the monorepo. Consumers re-export it (optionally appending overrides):
 *
 *   import { base } from '@zios/config/eslint';
 *   export default [...base, { rules: { ... } }];
 */
export const base = tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node },
    },
  },
  // Frontend code in this repo is TypeScript-only (.tsx/.ts); the design
  // reference's JSX is ported, never copied (AGENTS.md §7). Any .jsx file in
  // a linted context fails immediately.
  {
    files: ['**/*.jsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            '.jsx files are forbidden in this repo — port to strictly-typed .tsx instead (AGENTS.md §7).',
        },
      ],
    },
  },
  prettier,
);

export default base;
