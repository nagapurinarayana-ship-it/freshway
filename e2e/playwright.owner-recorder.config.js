import { defineConfig, devices } from '@playwright/test';

const ownerBaseURL = process.env.OWNER_BASE_URL || 'https://fwcoldpressed.in';

export default defineConfig({
  testDir: './tests/recorded',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: ownerBaseURL,
    storageState: '.auth/owner.json',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome']
  }
});
