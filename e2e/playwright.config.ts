import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright settings shared by every test.
 * Docs: https://playwright.dev/docs/test-configuration
 *
 * Before running: start the app (Docker Desktop → npm run db:up → npm run dev).
 */
export default defineConfig({
  // Where the test files are.
  testDir: './tests',

  // Give each test 30 seconds; each expect() waits up to 5 seconds for its condition.
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // Retry a failed test once on CI (a build server), never on your laptop.
  retries: process.env.CI ? 1 : 0,

  // Test files run in parallel in separate browsers. The market is shared by every test,
  // so tests that pause it or set prices must not overlap — keep one worker for now.
  workers: 1,

  // 'list' prints results in the terminal; 'html' builds a report you open with `npm run report -w e2e`.
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // page.goto('/login') means http://localhost:5173/login
    baseURL: 'http://localhost:5173',
    // Evidence collected when a test fails:
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure', // a step-by-step recording you can replay
  },

  // Which browsers to run in. Microsoft Edge is already installed on Windows,
  // so no browser download is needed. (Run `npx playwright install` to add Chromium/Firefox/WebKit.)
  projects: [
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
});
