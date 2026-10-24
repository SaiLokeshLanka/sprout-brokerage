import { defineConfig, devices } from '@playwright/test';
import { WEB_URL } from './src/config';

/**
 * Playwright settings for the Sprout test framework.
 * Docs: https://playwright.dev/docs/test-configuration
 *
 * Before running: start the app (Docker Desktop → npm run db:up → npm run dev).
 *
 * Projects = groups of tests with their own settings. Run one with --project, e.g.
 *   npx playwright test --project=api
 */

// Microsoft Edge is already installed on Windows, so no browser download is needed.
const edge = {
  ...devices['Desktop Edge'],
  channel: 'msedge',
  launchOptions: {
    // Edge opens its downloads panel as an extra hidden page after every download, which
    // Playwright then reports as "Target page, context or browser has been closed". Turn it off.
    args: ['--disable-features=msDownloadsHub,msEdgeDownloadsHub,DownloadBubble,DownloadBubbleV2'],
  },
};

export default defineConfig({
  testDir: './tests',

  // Give each test 30 seconds; each expect() waits up to 5 seconds for its condition.
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // Visual tests: allow a tiny difference (anti-aliasing), never animations.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },

  // Fail the run if someone leaves a test.only in the code (protects the CI server).
  forbidOnly: !!process.env.CI,
  // Retry a failed test once on CI (a build server), never on your laptop.
  retries: process.env.CI ? 1 : 0,

  // The simulated market is shared by every test, and tests freeze it or set prices.
  // Running tests at the same time would make them fight over prices, so: one at a time.
  workers: 1,

  // 'list' prints results in the terminal; 'html' builds a report (npm run report -w e2e);
  // 'junit' writes an XML file that CI servers understand (Phase 8).
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]],

  // Screenshots for visual tests live next to the tests, one folder per operating system
  // (fonts render slightly differently on Windows, macOS and Linux).
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',

  use: {
    // page.goto('/login') means http://localhost:5173/login
    baseURL: WEB_URL,
    // Evidence collected when a test fails:
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure', // a step-by-step recording you can replay: npx playwright show-trace <file>
  },

  projects: [
    // Runs first: checks the app is up and resets the market. Everything else depends on it,
    // so a stopped server gives ONE clear error instead of 50 confusing failures.
    { name: 'setup', testDir: './tests/setup', testMatch: /.*\.setup\.ts/ },

    // Backend only, no browser: status codes, response bodies, business rules.
    { name: 'api', testDir: './tests/api', dependencies: ['setup'] },

    // End-to-end tests in the browser.
    { name: 'ui', testDir: './tests/ui', dependencies: ['setup'], use: edge },

    // Screenshot comparison. Update the saved screenshots after an intended UI change:
    //   npx playwright test --project=visual --update-snapshots
    { name: 'visual', testDir: './tests/visual', dependencies: ['setup'], use: { ...edge, viewport: { width: 1280, height: 800 } } },

    // Accessibility scans with axe-core (WCAG 2.1 A and AA rules).
    { name: 'a11y', testDir: './tests/a11y', dependencies: ['setup'], use: edge },
  ],
});
