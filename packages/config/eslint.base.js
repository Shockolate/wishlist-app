import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat config for the Node packages (contracts, api, e2e). The web app uses
 * eslint-config-next instead.
 *
 * `decorators: true` tells the type-import rule that decorator metadata is emitted, so it won't
 * autofix a Nest-injected class into `import type` (which would erase it at runtime).
 */
export function baseEslintConfig({ tsconfigRootDir, decorators = false }) {
  return defineConfig([
    globalIgnores(['dist/**', 'coverage/**', '.turbo/**', '*.config.*', 'eslint.config.js']),
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
          ...(decorators ? { emitDecoratorMetadata: true, experimentalDecorators: true } : {}),
        },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      // Test bodies are untyped by nature (supertest bodies, mocks); parse them with contract
      // schemas where it matters instead of fighting the no-unsafe-* family.
      files: ['**/*.spec.ts', '**/*.int-spec.ts', 'test/**/*.ts', 'tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/unbound-method': 'off',
      },
    },
  ]);
}
