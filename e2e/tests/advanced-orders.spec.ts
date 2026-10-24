import { expect, test } from '@playwright/test';
import { API, inr, loginAsNewUser, marketOrder, prevClose, resetMarket, setPrice, tick5 } from './helpers';

const rupees = (paise: number) => (paise / 100).toFixed(2);

test.describe('Stop-loss and GTT orders', () => {
  test.afterEach(async ({ request }) => resetMarket(request));

  test('a stop-loss sell waits for its trigger, then sells when the price falls', async ({ page, request }) => {
    const token = await loginAsNewUser(page, request);
    const price = tick5(await prevClose(request, 'ITC'));
    const trigger = tick5(price * 0.97);
    await setPrice(request, 'ITC', price);
    await marketOrder(request, token, 'ITC', 'BUY', 5);

    await page.goto('/stocks/ITC');
    await page.getByTestId('side-sell').click();
    await page.getByTestId('ordertype-sl_m').click();
    await expect(page.getByTestId('ordertype-help')).toContainText('executes at the market price');
    await page.getByTestId('order-qty').fill('5');
    await page.getByTestId('order-trigger-price').fill(rupees(trigger));
    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('order-result')).toContainText(`Triggers when price falls to ${inr(trigger / 100)}`);

    await page.goto('/orders?filter=OPEN');
    const row = page.locator('[data-status="TRIGGER_PENDING"]');
    await expect(row.getByTestId('order-status')).toHaveText('TRIGGER PENDING');
    await expect(row.getByTestId('order-trigger')).toHaveText(`trigger ${inr(trigger / 100)}`);

    // The price falls through the trigger: the server sells at the market price, and the page updates live.
    const fallTo = trigger - 20;
    await setPrice(request, 'ITC', fallTo);
    await page.getByTestId('orders-filter-executed').click();
    const sold = page.getByTestId('orders-table').locator('tr', { hasText: 'SL-M' });
    await expect(sold.getByTestId('order-status')).toHaveText('EXECUTED');
    await expect(sold.getByTestId('order-price')).toContainText(inr(fallTo / 100));
  });

  test('the order panel shows the server rule before you place an invalid stop-loss', async ({ page, request }) => {
    const token = await loginAsNewUser(page, request);
    const price = tick5(await prevClose(request, 'ITC'));
    await setPrice(request, 'ITC', price);
    await marketOrder(request, token, 'ITC', 'BUY', 1);

    await page.goto('/stocks/ITC');
    await page.getByTestId('side-sell').click();
    await page.getByTestId('ordertype-sl_m').click();
    await page.getByTestId('order-trigger-price').fill(rupees(tick5(price * 1.05))); // above the price: wrong side
    await expect(page.getByTestId('order-preview-error')).toContainText('must be below the current price');
  });

  test('an OCO GTT created in the panel fires its stop-loss leg', async ({ page, request }) => {
    const token = await loginAsNewUser(page, request);
    const price = tick5(await prevClose(request, 'TCS'));
    const stop = tick5(price * 0.95);
    await setPrice(request, 'TCS', price);
    await marketOrder(request, token, 'TCS', 'BUY', 4);

    await page.goto('/stocks/TCS');
    await page.getByTestId('side-sell').click();
    await page.getByTestId('mode-gtt').click();
    await page.getByTestId('gtt-kind-oco').click();
    await page.getByTestId('gtt-qty').fill('4');
    await page.getByTestId('gtt-trigger').fill(rupees(tick5(price * 1.05)));
    await page.getByTestId('gtt-limit').fill(rupees(tick5(price * 1.05)));
    await page.getByTestId('gtt-stop-trigger').fill(rupees(stop));
    await page.getByTestId('gtt-stop-limit').fill(rupees(stop - 100));
    await page.getByTestId('create-gtt').click();
    await expect(page.getByTestId('gtt-result')).toContainText('GTT created');

    await page.goto('/orders?tab=gtt');
    await expect(page.getByTestId('gtt-status')).toHaveText('ACTIVE');
    await expect(page.getByTestId('gtt-prices')).toContainText(`Stop-loss ${inr(stop / 100)}`);

    await setPrice(request, 'TCS', stop - 10);
    await expect(page.getByTestId('gtt-status')).toHaveText('TRIGGERED');
    await expect(page.getByTestId('gtt-table')).toContainText('Stop-loss hit');
    await expect(page.getByTestId('cancel-gtt')).toHaveCount(0);
  });

  test('a GTT can be cancelled from the orders page', async ({ page, request }) => {
    const token = await loginAsNewUser(page, request);
    const price = tick5(await prevClose(request, 'INFY'));
    await setPrice(request, 'INFY', price);
    const res = await request.post(`${API}/gtt`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { symbol: 'INFY', side: 'BUY', kind: 'SINGLE', qty: 1, triggerPricePaise: tick5(price * 0.9), limitPricePaise: tick5(price * 0.9) },
    });
    expect(res.status()).toBe(201);

    await page.goto('/orders');
    await expect(page.getByTestId('orders-filter-gtt')).toHaveText('GTT (1 active)');
    await page.getByTestId('orders-filter-gtt').click();
    await page.getByTestId('cancel-gtt').click();
    await expect(page.getByTestId('orders-notice')).toHaveText('GTT cancelled');
    await expect(page.getByTestId('gtt-status')).toHaveText('CANCELLED');
  });
});
