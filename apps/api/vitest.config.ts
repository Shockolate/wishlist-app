import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest's default transform can't emit decorator metadata. Our DI uses explicit @Inject tokens
  // and doesn't depend on it, but compiling tests the way Nest's own Vitest template does keeps
  // test behavior identical to `nest build`.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    projects: [{ extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts'] } }],
  },
});
