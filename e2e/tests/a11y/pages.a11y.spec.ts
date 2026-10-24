import { expect, test } from '../../src/fixtures';
import { accessibilityProblems } from '../../src/utils/a11y';

/**
 * Automated accessibility checks (axe-core, WCAG 2.1 AA): colour contrast, labels on form fields,
 * names on buttons, valid ARIA, heading order… Automated tools find roughly a third of real
 * problems; keyboard and screen-reader checks by a person are still needed.
 */
test.describe('Accessibility', () => {
  test('login page', async ({ loginPage, page }) => {
    await loginPage.goto();
    await expect(loginPage.form).toBeVisible();
    expect(await accessibilityProblems(page)).toEqual([]);
  });

  // Logged-in pages: each test opens one page and scans it.
  const pages: { name: string; path: string; ready: string }[] = [
    { name: 'explore', path: '/', ready: 'index-strip' },
    { name: 'stock page', path: '/stocks/TCS', ready: 'order-panel' },
    { name: 'orders', path: '/orders', ready: 'orders-filter-all' },
    { name: 'funds', path: '/funds', ready: 'wallet-card' },
    { name: 'investments', path: '/investments', ready: 'investment-summary' },
    { name: 'reports', path: '/reports', ready: 'report-from' },
    { name: 'options chain', path: '/options', ready: 'option-chain' },
    { name: 'profile & KYC', path: '/account', ready: 'kyc-card' },
  ];
  for (const p of pages) {
    test(`${p.name} page`, async ({ trader, page }) => {
      await page.goto(p.path);
      await expect(page.getByTestId(p.ready)).toBeVisible();
      // The chart library draws on <canvas> and adds its own logo link; it isn't our markup to fix.
      expect(await accessibilityProblems(page, { exclude: ['.tv-lightweight-charts', '#tv-attr-logo'] }), `user ${trader.email}`).toEqual([]);
    });
  }

  test('the order panel with stop-loss fields and charges open', async ({ trader, stockPage, page }) => {
    await stockPage.goto('INFY');
    await stockPage.orderPanel.type('sl');
    await stockPage.orderPanel.charge('stt');
    expect(await accessibilityProblems(page, { exclude: ['.tv-lightweight-charts', '#tv-attr-logo'] }), `user ${trader.email}`).toEqual([]);
  });

  test('dark theme has enough colour contrast too', async ({ trader, explorePage, page }) => {
    await explorePage.goto();
    await expect(explorePage.indexStrip).toBeVisible();
    await explorePage.header.themeToggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await accessibilityProblems(page, { exclude: ['.tv-lightweight-charts', '#tv-attr-logo'] }), `user ${trader.email}`).toEqual([]);
  });
});
