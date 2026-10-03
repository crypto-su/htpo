import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/standalone',
  outputDir: 'test-results/standalone',
  timeout: 60000,
  workers: 1,
  use: { channel: 'chrome', headless: true, baseURL: 'http://127.0.0.1:5181' },
  // A plain HTTP server: no Vite transforms or module resolution.
  webServer: {
    command: 'node tests/standalone/server.mjs',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: false,
  },
});
