import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './real-d1',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['line'], ['html', { outputFolder: 'test-results/real-d1-report', open: 'never' }]],
  outputDir: 'test-results/real-d1',
  use: {
    baseURL: 'http://localhost:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome']
  },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 0.0.0.0 --directory ..',
    cwd: '.',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
