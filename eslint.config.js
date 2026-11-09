import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Flat config. Mirrors the backend's ruff gate: the build/CI runs `pnpm lint`.
// The high-value rule for this codebase is react-hooks (rules-of-hooks as an error,
// exhaustive-deps as a warning so the intentional one-time-init suppressions stay
// explicit). TS/style findings are warnings — they surface without wedging CI.
export default tseslint.config(
  // `.claude` holds transient agent worktrees (full repo copies) that must not be linted.
  // `src/lib/api/schema.d.ts` is generated (`pnpm openapi:types`) and checked by its own test.
  { ignores: ['dist', 'dev-dist', 'coverage', 'reports', '.x-stryker-tmp', 'node_modules', '.claude', 'src/lib/api/schema.d.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // rules-of-hooks is the non-negotiable correctness rule → stays an error.
      'react-hooks/rules-of-hooks': 'error',
      // exhaustive-deps + the React-Compiler static rules (immutability, purity,
      // set-state-in-effect, refs, preserve-manual-memoization) flag real cleanup. They are
      // warnings, and the per-rule ratchet holds their counts (scripts/lint-ratchet.mjs ·
      // scripts/eslint-baseline.json): a count may go down, never up.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // console.error/warn are intentional (ErrorBoundary, load failures); ban only log/debug.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // the codebase deliberately uses side-effecting ternaries / short-circuits as statements.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // only flag when EVERY destructured binding could be const (some share a let reassignment).
      'prefer-const': ['error', { destructuring: 'all' }],
      // a warning the ratchet counts (scripts/eslint-baseline.json) – surface, don't block.
      '@typescript-eslint/no-explicit-any': 'warn',
      // a `!` is a cast the compiler cannot check; lint is not type-aware, so nothing else counts
      // them – the ratchet holds the number (sweep 23.10.2026, B.13). Tests are exempt below.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // test files run under node + vitest globals
  {
    files: ['**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
    // a fixture's `!` asserts what the test just arranged; a wrong one fails the test itself
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  // The UI reaches the backend through ONE door, src/lib/incidents (see its header); src/lib is
  // the data layer and imports lib/api/* directly. Tests may import a module under test anywhere.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/**', 'src/**/*.test.{ts,tsx}', 'src/**/*.setup.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        regex: '/lib/api/(incidents|workspace|workspaceSync|events|media|divera|personnel|geo|objects|reference)$',
        message: "Import it from 'lib/incidents' – the UI's one entry point to the backend calls.",
      }] }],
    },
  },
  // Playwright e2e: node, and a fixture's `use` callback is Playwright's, not React's hook
  {
    files: ['e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  // Every spec takes `test` from ./helpers: that one carries the client-error guard (e2e/guard.ts),
  // and a spec on the bare Playwright `test` would pass through a render storm unnoticed.
  {
    files: ['e2e/**/*.ts'],
    ignores: ['e2e/guard.ts'], // the one file that extends the bare `test`
    rules: {
      'no-restricted-imports': ['error', { paths: [{
        // `default` too: the package's default export IS `test`
        name: '@playwright/test', importNames: ['test', 'default'],
        message: "Import `test` from './helpers' — it carries the client-error guard (e2e/guard.ts).",
      }] }],
    },
  },
)
