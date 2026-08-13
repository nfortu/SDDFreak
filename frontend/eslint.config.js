import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'src/api/schema.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', console: 'readonly', fetch: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // TR-STR-003: the frontend never reaches into the backend tree.
      'no-restricted-imports': [
        'error',
        { patterns: ['**/backend/**', '../../backend/*', '@sddfreak/backend*'] },
      ],
    },
  },
);
