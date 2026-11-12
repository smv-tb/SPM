import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/hermes/**'],
      exclude: ['**/__tests__/**', '**/*.test.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      // Floor at the current baseline (2026-10): raise it as tests are added, never lower it.
      thresholds: { lines: 40 },
    },
  },
})