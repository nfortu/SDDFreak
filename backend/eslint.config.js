import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // TR-STR-003: the backend never reaches into the frontend tree.
      'no-restricted-imports': [
        'error',
        { patterns: ['**/frontend/**', '../../frontend/*', '@sddfreak/frontend*'] },
      ],
    },
  },
);
