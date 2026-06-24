import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat config for ESLint 9+/10. TypeScript-aware, sensible defaults for a
 * Node CLI project. Keeps the existing code style (error:any catches, etc.)
 * rather than fighting it.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.npm/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        ReadableStream: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    rules: {
      // The codebase legitimately uses `any` for error objects and LLM payloads.
      '@typescript-eslint/no-explicit-any': 'off',
      // Dynamic requires/imports are used for provider SDKs and config loading.
      '@typescript-eslint/no-require-imports': 'off',
      // Allow unused vars when prefixed with _ (intentional skips).
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Console is the CLI's output channel by design.
      'no-console': 'off',
    },
  },
);
