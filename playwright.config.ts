import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 180000, workers: 1,
  use: { channel: 'chrome', headless: true, baseURL: 'http://127.0.0.1:5180' },
  webServer: { command: 'node tests/browser/server.mjs', url: 'http://127.0.0.1:5180', reuseExistingServer: false },
});
