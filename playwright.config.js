// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 7200000, // 120 minutes in milliseconds
  expect: { timeout: 15_000 },
  fullyParallel: false, // Sequential to avoid resource contention during perf testing
  retries: 0, // No retries — we want accurate perf data
  workers: 1, // Single worker for consistent measurements
  reporter: [
    ['html', { outputFolder: path.resolve(__dirname, 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.resolve(__dirname, 'reports/playwright-results.json') }],
    ['list'],
  ],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off', // Disable video for accurate performance measurement
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorSchemePref: 'light',
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        throttleConfig: { cpu: 4, network: 'slow-4g' }, // 4x mobile CPU throttling, slow-4g network emulation
        colorSchemePref: 'light',
      },
    },
    {
      name: 'desktop-chrome-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorSchemePref: 'dark', // Test Dark Mode assets rendering
      },
    },
    {
      name: 'desktop-firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
