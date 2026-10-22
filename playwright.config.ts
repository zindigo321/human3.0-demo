import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:4310',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 960 },
    launchOptions: { executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
});
