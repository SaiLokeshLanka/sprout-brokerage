import { expect, test } from '@playwright/test';
import { API, loginAsNewUser, resetMarket, setPrice } from './helpers';

/** Puts NIFTY exactly ₹10 above a strike, so the at-the-money strike is known. Returns that strike (rupees). */
async function pinNifty(request: import('@playwright/test').APIRequestContext) {
  const ltp = (await (await request.get(`${API}/market/quotes/NIFTY`)).json()).ltpPaise as number;
  const strike = Math.round(ltp / 5000) * 50;
  await setPrice(request, 'NIFTY', strike * 100 + 1000);
  return strike;
}

test.describe('Options', () => {
  test.afterEach(async ({ request }) => resetMarket(request));

  test('the chain shows calls and puts around the index price', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    const strike = await pinNifty(request);

    await page.getByTestId('nav-options').click();
    await expect(page.getByTestId('option-chain')).toBeVisible();
    await expect(page.getByTestId('chain-lot')).toHaveText('75');
    await expect(page.locator('[data-testid^="strike-"]')).toHaveCount(31);
    await expect(page.getByTestId(`strike-${strike}`)).toHaveClass(/atm/);
    // The index price line sits just below the ATM strike row (index is ₹10 above it).
    await expect(page.getByTestId(`strike-${strike}`).locator('xpath=following-sibling::tr[1]')).toHaveAttribute('data-testid', 'spot-row');

    await page.getByTestId('underlying-BANKNIFTY').click();
    await expect(page.getByTestId('chain-lot')).toHaveText('35');
  });

  test('buy one lot of a call, see the position, then sell it', async ({ page, request }) => {
    await loginAsNewUser(page, request);
    const strike = await pinNifty(request);
    const chain = await (await request.get(`${API}/options/chain?underlying=NIFTY`)).json();
    const call = chain.rows.find((r: { strikePaise: number }) => r.strikePaise === strike * 100).call;

    await page.goto('/options');
    await page.getByTestId(`ltp-${call.symbol}`).click();
    await expect(page.getByTestId('order-panel')).toContainText(call.name);
    const delta = Number(await page.getByTestId('greek-delta').textContent());
    expect(delta).toBeGreaterThan(0.4);
    expect(delta).toBeLessThan(0.7);
    // Options have a flat ₹20 brokerage per order.
    await page.getByTestId('order-charges').locator('summary').click();
    await expect(page.getByTestId('charge-brokerage')).toHaveText('₹20.00');

    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('order-result')).toContainText(`Bought 75 × ${call.symbol}`);
    const position = page.getByTestId(`position-${call.symbol}`);
    await expect(position.getByTestId('position-qty')).toContainText('75');
    await expect(position.getByTestId('position-qty')).toContainText('1 lot');

    await page.getByTestId('side-sell').click();
    await expect(page.getByTestId('order-holding')).toHaveText('75 units');
    await page.getByTestId('place-order').click();
    await expect(page.getByTestId('order-result')).toContainText(`Sold 75 × ${call.symbol}`);
    await expect(position).toHaveCount(0);
  });

  test('a position is settled in cash at expiry', async ({ page, request }) => {
    const token = await loginAsNewUser(page, request);
    const strike = await pinNifty(request);
    const chain = await (await request.get(`${API}/options/chain?underlying=NIFTY`)).json();
    const call = chain.rows.find((r: { strikePaise: number }) => r.strikePaise === strike * 100).call;
    const buy = await request.post(`${API}/orders`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { symbol: call.symbol, side: 'BUY', orderType: 'MARKET', qty: 75 },
    });
    expect((await buy.json()).status).toBe('EXECUTED');

    await page.goto('/investments');
    await expect(page.getByTestId(`position-${call.symbol}`)).toBeVisible();

    // Expiry day: the index is ₹10 above the strike, so the call pays ₹10 per unit.
    const settle = await request.post(`${API}/test/options/settle`, { data: { expiry: chain.expiry } });
    expect((await settle.json()).settled).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId(`position-${call.symbol}`)).toHaveCount(0);

    await page.goto('/orders?filter=EXECUTED');
    const row = page.getByTestId('orders-table').locator('tr', { hasText: 'Settled at expiry' });
    await expect(row.getByTestId('order-price')).toContainText('₹10.00');
  });
});
