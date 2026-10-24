import { expect, test } from '../../src/fixtures';
import type { MarketControl } from '../../src/api/MarketControl';
import type { ApiClient } from '../../src/api/ApiClient';

/** Puts NIFTY exactly ₹10 above a strike, so the at-the-money strike is known. Returns that strike's call. */
async function atmCall(market: MarketControl, api: ApiClient) {
  const { ltpPaise } = await api.quote('NIFTY');
  const strikePaise = Math.round(ltpPaise / 5000) * 5000;
  await market.setPrice('NIFTY', strikePaise + 1000);
  const chain = await api.optionChain('NIFTY');
  return { strike: strikePaise / 100, expiry: chain.expiry, call: chain.rows.find((r) => r.strikePaise === strikePaise)!.call };
}

test.describe('Options', () => {
  test('the chain shows calls and puts around the index price', async ({ trader, market, api, optionsPage }) => {
    const { strike } = await atmCall(market, api);

    await optionsPage.goto();
    await expect(optionsPage.chain).toBeVisible();
    await expect(optionsPage.lotSize).toHaveText('75');
    await expect(optionsPage.strikeRows).toHaveCount(31);
    await expect(optionsPage.strikeRow(strike)).toHaveClass(/atm/);
    // The index price line sits just below the ATM strike row (the index is ₹10 above it).
    await expect(optionsPage.strikeRow(strike).locator('xpath=following-sibling::tr[1]')).toHaveAttribute('data-testid', 'spot-row');

    await optionsPage.underlying('BANKNIFTY');
    await expect(optionsPage.lotSize).toHaveText('35');
  });

  test('buy one lot of a call, see the position, then sell it', { tag: '@smoke' }, async ({ trader, market, api, optionsPage }) => {
    const { call } = await atmCall(market, api);
    const panel = optionsPage.orderPanel;

    await optionsPage.goto();
    await optionsPage.select(call.symbol);
    await expect(panel.root).toContainText(call.name);
    const delta = Number(await optionsPage.greek('delta').textContent());
    expect(delta).toBeGreaterThan(0.4);
    expect(delta).toBeLessThan(0.7);
    await expect(await panel.charge('brokerage')).toHaveText('₹20.00'); // options: flat ₹20 per order

    await panel.placeButton.click();
    await expect(panel.result).toContainText(`Bought 75 × ${call.symbol}`);
    const position = optionsPage.position(call.symbol);
    await expect(position.getByTestId('position-qty')).toContainText('75');
    await expect(position.getByTestId('position-qty')).toContainText('1 lot');

    await panel.side('SELL');
    await expect(panel.holding).toHaveText('75 units');
    await panel.placeButton.click();
    await expect(panel.result).toContainText(`Sold 75 × ${call.symbol}`);
    await expect(position).toHaveCount(0);
  });

  test('a position is settled in cash at expiry', async ({ trader, market, api, investmentsPage, ordersPage }) => {
    const { call, expiry } = await atmCall(market, api);
    await trader.api.buy(call.symbol, 75);

    await investmentsPage.goto();
    await expect(investmentsPage.optionPosition(call.symbol)).toBeVisible();

    // Expiry day: the index is ₹10 above the strike, so the call pays ₹10 per unit.
    expect((await market.settleOptions(expiry)).settled).toBeGreaterThanOrEqual(1);
    await expect(investmentsPage.optionPosition(call.symbol)).toHaveCount(0);

    await ordersPage.goto('executed');
    await expect(ordersPage.rows('Settled at expiry').getByTestId('order-price')).toContainText('₹10.00');
  });
});
