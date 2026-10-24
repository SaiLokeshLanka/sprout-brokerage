import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inr, loginAsNewUser, marketOrder, prevClose, resetMarket, setPrice, tick5, todayIst } from './helpers';

test.describe('Portfolio & reports', () => {
  test.afterEach(async ({ request }) => resetMarket(request));

  test('the P&L report shows the realised profit and downloads as CSV', async ({ page, request }) => {
    const token = await loginAsNewUser(page, request);
    const buyAt = tick5(await prevClose(request, 'TCS'));
    const sellAt = tick5(buyAt * 1.02);
    // Arrange through the API: buy 2, price rises, sell 2.
    await setPrice(request, 'TCS', buyAt);
    await marketOrder(request, token, 'TCS', 'BUY', 2);
    await setPrice(request, 'TCS', sellAt);
    await marketOrder(request, token, 'TCS', 'SELL', 2);
    const profit = (2 * (sellAt - buyAt)) / 100;

    await page.goto('/reports');
    await expect(page.getByTestId('pnl-row-TCS').getByTestId('pnl-row-realized')).toHaveText(inr(profit));
    await expect(page.getByTestId('pnl-total')).toHaveText(inr(profit));

    // Downloads: start waiting for the 'download' event BEFORE clicking, then read the saved file.
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('report-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^sprout-pnl-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv.split('\r\n')[0]).toContain('Symbol,Name,Trades');
    expect(csv).toContain(`TCS,Tata Consultancy Services,2,2,`);
    expect(csv).toContain(`,${profit.toFixed(2)}\r\n`);
  });

  test('the trade book links to a printable contract note', async ({ page, request }) => {
    const token = await loginAsNewUser(page, request);
    const price = tick5(await prevClose(request, 'INFY'));
    await setPrice(request, 'INFY', price);
    await marketOrder(request, token, 'INFY', 'BUY', 5);
    await marketOrder(request, token, 'INFY', 'SELL', 2);

    await page.goto('/reports');
    await page.getByTestId('report-tab-trades').click();
    await expect(page.getByTestId('trade-row')).toHaveCount(2);

    await page.getByTestId(`contract-note-${todayIst()}`).click();
    await expect(page.getByTestId('cn-row')).toHaveCount(2);
    // Bought 5, sold 2 at the same price → you pay for 3 shares.
    await expect(page.getByTestId('cn-net')).toContainText('Net amount payable');
    await expect(page.getByTestId('cn-net')).toContainText(inr((3 * price) / 100));
    await expect(page.getByTestId('print-note')).toBeVisible();
  });

  test('the statement lists cash movements with the right closing balance', async ({ page, request }) => {
    const token = await loginAsNewUser(page, request);
    const price = tick5(await prevClose(request, 'ITC'));
    await setPrice(request, 'ITC', price);
    await marketOrder(request, token, 'ITC', 'BUY', 10);

    await page.goto('/reports?tab=statement');
    await expect(page.getByTestId('statement-row')).toHaveCount(2); // welcome bonus + the buy
    await expect(page.getByTestId('statement-closing')).toHaveText(inr(100000 - (10 * price) / 100));
  });

  test('the investments page shows sector allocation and realised P&L today', async ({ page, request }) => {
    const token = await loginAsNewUser(page, request);
    const tcs = tick5(await prevClose(request, 'TCS'));
    const rel = tick5(await prevClose(request, 'RELIANCE'));
    await setPrice(request, 'TCS', tcs);
    await setPrice(request, 'RELIANCE', rel);
    await marketOrder(request, token, 'TCS', 'BUY', 2);
    await marketOrder(request, token, 'RELIANCE', 'BUY', 2);
    await setPrice(request, 'TCS', tcs + 500); // +₹5 per share
    await marketOrder(request, token, 'TCS', 'SELL', 1);

    await page.goto('/investments');
    await expect(page.getByTestId('alloc-row')).toHaveCount(2); // IT and Oil & Gas
    await expect(page.getByTestId('funds-realized-today')).toHaveText(inr(5));
  });

  test('an invalid date range shows the server error', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    await page.goto('/reports');
    await page.getByTestId('report-from').fill('2015-01-01'); // more than 5 years before "to"
    await expect(page.getByTestId('report-error')).toHaveText('Date range can be at most 5 years');
  });
});
