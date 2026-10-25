import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const unusedOptions = {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrors: 'none',
  ignoreRestSiblings: true,
};

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '.wrangler/**',
    '.vercel/**',
    '.sites-runtime/**',
    '.impeccable/**',
    'data/**',
    'uploads/**',
    'artifacts/**',
    'output/**',
    'public/**',
    'docs/**',
    'src/features/map-data/cities.ts',
    'src/features/map-data/china-paths.ts',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest' },
    rules: { 'no-unused-vars': ['error', unusedOptions] },
  },
  {
    files: ['**/*.{js,mjs,cjs}', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: { '@typescript-eslint/no-unused-vars': ['error', unusedOptions] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['worker/**/*.mjs'],
    languageOptions: { globals: globals.worker },
  },
  // Prettier owns formatting; keep ESLint focused on code correctness.
  prettier,
]);
