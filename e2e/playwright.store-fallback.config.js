import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './isolated',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4178' },
  webServer: {
    command: 'node ./isolated/store-fallback-server.js',
    url: 'http://127.0.0.1:4178/health',
    reuseExistingServer: false,
    timeout: 30000
  }
});
