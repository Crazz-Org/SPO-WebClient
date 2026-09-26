// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'cache/**',
      'webclient-cache/**',
      'public/**',
      '.claude/**',
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    // These are CommonJS by design — the Jest plumbing, the scripts, and the
    // legacy-archaeology generators behind report/rdo-surface-coverage.html.
    files: ['jest.config.js', 'src/__mocks__/**/*.js', 'scripts/**/*.js', 'report/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly', process: 'readonly', console: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.js'],
    rules: {
      // TypeScript already resolves every identifier; no-undef only reports DOM and
      // Node globals it cannot see, which is noise.
      'no-undef': 'off',
      // The project pulls in vite/client and jest types this way.
      '@typescript-eslint/triple-slash-reference': 'off',
      // CLAUDE.md forbids `any`: unknown in catch blocks, typed interfaces for data.
      '@typescript-eslint/no-explicit-any': 'error',
      // Arguments are not checked: most signatures here are dictated by a callback
      // or an interface, so an unused parameter carries information rather than dirt.
      // Unused *variables* stay an error — that is where dead code actually hides.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `cond ? a() : b()` as a statement is used throughout the UI and the emitter.
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
      // Initialise-then-branch is a deliberate shape in the parsers, and rdo.ts is
      // one of the files that must not be touched without discussion.
      'no-useless-assignment': 'warn',
      // A timer handle referenced by the callback it schedules cannot be a const.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },

  {
    files: ['src/client/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Guards the selector-stability trap that produces React error #185.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'src/mock-server/**/*.ts',
      'src/**/__tests__/**/*.ts',
      'scripts/**/*.js',
    ],
    rules: {
      // Tests reach for any to build partial doubles, require() to reset modules,
      // Function for spies, and @ts-nocheck for the raw RDO frame fixtures.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      // A binding a test never reads is not always dead: jest.spyOn installs the spy,
      // and a saved original exists to be restored. Deleting one can change what the
      // test does, so this reports without blocking — a human decides case by case.
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },

  {
    // A private field that is written but never read is dead state kept alive by its own tests.
    // src/client/ is left out: its renderer carries five such members that are a separate card.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/client/**'],
    rules: {
      '@typescript-eslint/no-unused-private-class-members': 'error',
    },
  },

  // Must stay last: switches off every rule Prettier owns.
  prettier
);
