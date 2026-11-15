import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist', '**/storybook-static', 'context/**', 'packages/errors/src/catalog.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // CLAUDE.md "Never do": no alert(), no console.error as user feedback, no swallowed errors.
      'no-alert': 'error',
      'no-console': ['error', { allow: ['warn'] }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Never blue/gray UI chrome: Tailwind's default palette is removed in styles.css; this catches hex drift.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#(?:[0-9a-fA-F]{3}){1,2}\\b/]',
          message: 'Use a token (bg-rose-600, var(--sl-color-…)), not a hex value.',
        },
      ],
    },
  },
);
