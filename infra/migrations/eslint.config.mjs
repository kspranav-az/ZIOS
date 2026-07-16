import { base } from '@zios/config/eslint';

export default [
  ...base,
  {
    // This package is deliberately CommonJS — node-pg-migrate's zero-risk
    // integration path (ADR-0003).
    files: ['**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
