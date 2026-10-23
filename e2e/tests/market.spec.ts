import { expect, test } from '@playwright/test';

const API = 'http://localhost:3000/api';

// Format a rupee amount exactly like the app does (Indian digit grouping: ₹1,00,000.00).
const inr = (rupees: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(rupees);

test.describe('Live prices', () => {
  // Runs before every test in this group: log in as the demo user.
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('use-demo').click();
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('index-strip')).toBeVisible();
  });

  // Runs after every test, even a failed one: never leave the shared market frozen or closed.
  test.afterEach(async ({ request }) => {
    await request.post(`${API}/test/market/session`, { data: { state: 'auto' } });
    await request.post(`${API}/test/market/resume`);
  });

  test('the stock page shows the exact price set on the server', async ({ page, request }) => {
    // Arrange: freeze the market and pick a price 1% above yesterday's close (always inside the circuit band).
    // `request` calls the API directly — no browser needed for setup.
    await request.post(`${API}/test/market/pause`);
    const quote = await (await request.get(`${API}/market/quotes/TCS`)).json();
    const target = Math.round(quote.prevClosePaise * 1.01 / 5) * 5 / 100; // rounded to the ₹0.05 tick
    const res = await request.post(`${API}/test/market/price`, { data: { symbol: 'TCS', price: target } });
    expect(res.ok()).toBeTruthy();

    // Act
    await page.goto('/stocks/TCS');

    // Assert: the big price on the page is exactly our price
    await expect(page.getByTestId('stock-ltp')).toHaveText(inr(target));
  });

  test('a price change on the server reaches the open page live (WebSocket)', async ({ page, request }) => {
    await request.post(`${API}/test/market/pause`);
    const quote = await (await request.get(`${API}/market/quotes/INFY`)).json();
    await page.goto('/stocks/INFY');

    // Change the price while the page is already open — no reload.
    const target = Math.round(quote.prevClosePaise * 0.98 / 5) * 5 / 100;
    await request.post(`${API}/test/market/price`, { data: { symbol: 'INFY', price: target } });

    // expect() keeps re-checking until the text matches (up to 5s), so no manual waiting is needed.
    await expect(page.getByTestId('stock-ltp')).toHaveText(inr(target));
  });

  test('buying is blocked while the market is closed', async ({ page, request }) => {
    await page.goto('/stocks/RELIANCE');
    await expect(page.getByTestId('place-order')).toBeEnabled();

    await request.post(`${API}/test/market/session`, { data: { state: 'closed' } });

    await expect(page.getByTestId('market-status')).toContainText('Market closed');
    await expect(page.getByTestId('market-closed-warning')).toBeVisible();
    await expect(page.getByTestId('place-order')).toBeDisabled();
  });
});
