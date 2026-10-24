import { expect, test } from '../../src/fixtures';

/**
 * Visual regression tests: each screenshot is compared pixel by pixel with a saved "baseline".
 * They catch what other tests miss — broken layout, wrong colours, overlapping text.
 *
 * Only screens that look the same every time are captured; anything that changes on its own
 * (live prices, today's date, generated ids) is covered with a mask box.
 *
 * After an intended design change, review the new look and save it as the new baseline:
 *   npx playwright test --project=visual --update-snapshots
 */
test.describe('Visual', () => {
  test('login page', async ({ loginPage, page }) => {
    await loginPage.goto();
    await loginPage.fontsReady();
    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  });

  test('login page in dark theme', async ({ loginPage, page }) => {
    // addInitScript runs before the app's own code on every page load.
    await page.addInitScript(() => localStorage.setItem('sprout.theme', 'dark'));
    await loginPage.goto();
    await loginPage.fontsReady();
    await expect(page).toHaveScreenshot('login-dark.png', { fullPage: true });
  });

  test('login page on a phone', async ({ loginPage, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginPage.goto();
    await loginPage.fontsReady();
    await expect(page).toHaveScreenshot('login-mobile.png', { fullPage: true });
  });

  test('sign-up form with a validation error', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.register('Visual Tester', 'visual@example.com', 'short');
    await expect(loginPage.error).toBeVisible();
    await loginPage.fontsReady();
    await expect(loginPage.form).toHaveScreenshot('signup-error.png');
  });

  test('orders page with no orders yet', async ({ trader, ordersPage }) => {
    await ordersPage.goto();
    await expect(ordersPage.filterTab('all')).toHaveText('All (0)');
    await ordersPage.fontsReady();
    await expect(ordersPage.page).toHaveScreenshot('orders-empty.png', { fullPage: true });
  });

  test('contract note for a day without trades', async ({ trader, contractNotePage }) => {
    await contractNotePage.goto('2025-01-01');
    await expect(contractNotePage.empty).toBeVisible();
    await contractNotePage.fontsReady();
    await expect(contractNotePage.note).toHaveScreenshot('contract-note-empty.png', {
      // The note number and email are different for every test user.
      mask: [contractNotePage.number, contractNotePage.page.getByText(trader.email)],
    });
  });

  test('order panel with stop-loss fields', async ({ trader, market, stockPage }) => {
    await market.pricedAt('TCS');
    await stockPage.goto('TCS');
    await stockPage.orderPanel.type('sl');
    await expect(stockPage.orderPanel.chargesTotal).toBeVisible();
    await stockPage.fontsReady();
    const panel = stockPage.orderPanel;
    await expect(panel.root).toHaveScreenshot('order-panel-sl.png', {
      // Prices move from day to day (yesterday's close changes), so hide every number that depends on them.
      mask: [panel.root.getByTestId('order-ltp'), panel.triggerPrice, panel.limitPrice, panel.youPay, panel.charges],
    });
  });

  test('options page help card', async ({ trader, optionsPage }) => {
    await optionsPage.goto();
    await expect(optionsPage.help).toBeVisible();
    await optionsPage.fontsReady();
    await expect(optionsPage.help).toHaveScreenshot('options-help.png');
  });
});
