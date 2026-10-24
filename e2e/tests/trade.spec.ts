import { expect, test } from '@playwright/test';
import { inr, loginAsNewUser, prevClose, resetMarket, setPrice, tick5 } from './helpers';

test.describe('Trading', () => {
  test.afterEach(async ({ request }) => resetMarket(request));

  test('a market buy debits the wallet and creates a holding', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    const price = tick5(await prevClose(request, 'TCS'));
    await setPrice(request, 'TCS', price);

    await page.goto('/stocks/TCS');
    await page.getByTestId('order-qty').fill('2');
    await page.getByTestId('place-order').click();

    await expect(page.getByTestId('order-result')).toContainText(`Bought 2 × TCS @ ${inr(price / 100)}`);
    await expect(page.getByTestId('your-position')).toContainText('Shares2');

    // The money really left the wallet: the server ledger shows the trade.
    await page.goto('/funds');
    await expect(page.getByTestId('wallet-balance')).toHaveText(inr(100000 - (2 * price) / 100));
    await expect(page.getByTestId('txn-row').first()).toHaveAttribute('data-type', 'TRADE_BUY');
  });

  test('a limit buy waits with money blocked, then fills when the price drops', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    const price = tick5(await prevClose(request, 'INFY'));
    const limit = tick5(price * 0.98);
    await setPrice(request, 'INFY', price);

    await page.goto('/stocks/INFY');
    await page.getByTestId('ordertype-limit').click();
    await page.getByTestId('order-limit-price').fill((limit / 100).toFixed(2));
    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('order-result')).toContainText('Limit order placed');

    await page.goto('/funds');
    await expect(page.getByTestId('wallet-blocked')).toHaveText(inr(limit / 100));

    await page.goto('/orders');
    await expect(page.getByTestId('order-status').first()).toHaveText('OPEN');

    // The price reaches the limit on the server — the open page updates live, no reload.
    await setPrice(request, 'INFY', limit);
    await expect(page.getByTestId('order-status').first()).toHaveText('EXECUTED');
  });

  test('cancelling an open order releases the blocked money', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    const price = tick5(await prevClose(request, 'HDFCBANK'));
    await setPrice(request, 'HDFCBANK', price);

    await page.goto('/stocks/HDFCBANK');
    await page.getByTestId('ordertype-limit').click();
    await page.getByTestId('order-limit-price').fill((tick5(price * 0.95) / 100).toFixed(2));
    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('order-result')).toContainText('Limit order placed');

    await page.goto('/orders');
    await page.getByTestId('cancel-order').click();
    await expect(page.getByTestId('orders-notice')).toHaveText('Order cancelled');
    await expect(page.getByTestId('order-status').first()).toHaveText('CANCELLED');

    await page.goto('/funds');
    await expect(page.getByTestId('wallet-blocked')).toHaveText(inr(0));
    await expect(page.getByTestId('wallet-balance')).toHaveText(inr(100000));
  });

  test('selling at a higher price books a realised profit', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    const buyAt = tick5(await prevClose(request, 'ITC'));
    const sellAt = tick5(buyAt * 1.02);
    await setPrice(request, 'ITC', buyAt);

    await page.goto('/stocks/ITC');
    await page.getByTestId('order-qty').fill('3');
    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('order-result')).toContainText('Bought 3 × ITC');

    await setPrice(request, 'ITC', sellAt);
    await page.getByTestId('side-sell').click();
    await page.getByTestId('order-qty').fill('3');
    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('order-result')).toContainText(`Sold 3 × ITC @ ${inr(sellAt / 100)}`);

    await page.goto('/investments');
    await expect(page.getByTestId('funds-realized')).toHaveText(inr((3 * (sellAt - buyAt)) / 100));
  });

  test('selling a stock you do not own is rejected by the server', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    await page.goto('/stocks/WIPRO');
    await page.getByTestId('side-sell').click();
    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('order-result')).toHaveText("Order rejected: You don't hold this stock");
  });
});
