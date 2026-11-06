import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Dedicated test config.
 *
 * It intentionally does NOT reuse vite.config.ts: that config sets `root` to
 * src/renderer for the web build, which would make Vitest look for tests in the
 * wrong place. Tests cover main-process logic, so the Node environment is used
 * (no DOM) except where a file opts in via a docblock.
 */
export default defineConfig({
  root: here,
  resolve: {
    alias: {
      '@shared': resolve(here, 'src/shared'),
      '@': resolve(here, 'src/renderer'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    globals: false,
    reporters: ['default'],
    // Main-process code under test is dependency-injected, so no setup file
    // is needed and no real network or API key is ever touched.
  },
});
