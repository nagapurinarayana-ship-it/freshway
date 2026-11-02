import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './production',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['line'], ['html', { outputFolder: 'test-results/production-report', open: 'never' }]],
  outputDir: 'test-results/production',
  use: {
    baseURL: process.env.FRESHWAY_PRODUCTION_URL || 'https://fwcoldpressed.in',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome']
  }
});
