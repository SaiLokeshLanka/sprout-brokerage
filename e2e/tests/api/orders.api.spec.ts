import { expect, test } from '../../src/fixtures';
import { WELCOME_BONUS_PAISE } from '../../src/data/users';
import { deliveryCharges, tick5 } from '../../src/utils/money';

test.describe('Orders API', () => {
  test('a market buy executes at the live price and charges exactly what the preview said', { tag: '@smoke' }, async ({ market, newTrader }) => {
    const price = await market.pricedAt('TCS');
    const order = { symbol: 'TCS', side: 'BUY' as const, orderType: 'MARKET' as const, qty: 3 };

    const preview = await newTrader.api.preview(order);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ valuePaise: 3 * price, sufficientFunds: true });
    expect(preview.body.charges.totalPaise).toBe(deliveryCharges('BUY', 3 * price));

    const placed = await newTrader.api.placeOrder(order);
    expect(placed.status).toBe(201);
    expect(placed.body).toMatchObject({ status: 'EXECUTED', fillPricePaise: price, chargesPaise: preview.body.charges.totalPaise });
    expect((await newTrader.api.wallet()).balancePaise).toBe(WELCOME_BONUS_PAISE - preview.body.totalPaise);
  });

  // Invalid input → 400 and nothing is recorded. The price is filled in once the market is set.
  const invalid: { name: string; order: (p: number) => Record<string, unknown>; message: RegExp }[] = [
    { name: 'an index', order: () => ({ symbol: 'NIFTY', side: 'BUY', orderType: 'MARKET', qty: 1 }), message: /Indices cannot be traded/ },
    { name: 'an unknown symbol', order: () => ({ symbol: 'NOPE', side: 'BUY', orderType: 'MARKET', qty: 1 }), message: /Unknown symbol/ },
    { name: 'qty 0', order: () => ({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 0 }), message: /at least 1/ },
    { name: 'a price off the ₹0.05 tick', order: (p) => ({ symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 1, limitPricePaise: p + 3 }), message: /multiple of/ },
    { name: 'a price outside the circuit band', order: (p) => ({ symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 1, limitPricePaise: tick5(p * 1.5) }), message: /price band/ },
    { name: 'a stop-loss sell above the price', order: (p) => ({ symbol: 'TCS', side: 'SELL', orderType: 'SL_M', qty: 1, triggerPricePaise: tick5(p * 1.02) }), message: /below the current price/ },
    { name: 'an unknown field', order: () => ({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1, discount: 50 }), message: /should not exist/ },
  ];
  for (const row of invalid) {
    test(`an order for ${row.name} → 400, nothing recorded`, async ({ market, newTrader }) => {
      const price = await market.pricedAt('TCS');
      const res = await newTrader.api.placeOrder(row.order(price) as never);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toMatch(row.message);
      expect(await newTrader.api.orders()).toHaveLength(0);
    });
  }

  test('risk checks record a REJECTED order with the reason', async ({ market, newTrader }) => {
    await market.pricedAt('TCS');
    const tooBig = await newTrader.api.placeOrder({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 100_000 });
    expect(tooBig.body).toMatchObject({ status: 'REJECTED', statusReason: 'Insufficient funds' });

    await market.close();
    const closed = await newTrader.api.placeOrder({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1 });
    expect(closed.body).toMatchObject({ status: 'REJECTED', statusReason: 'Market is closed' });
  });

  test('a limit buy blocks money; cancelling returns it; cancelling twice → 409', async ({ market, newTrader }) => {
    const price = await market.pricedAt('INFY');
    const limit = tick5(price * 0.95);
    const placed = await newTrader.api.placeOrder({ symbol: 'INFY', side: 'BUY', orderType: 'LIMIT', qty: 2, limitPricePaise: limit });
    expect(placed.body.status).toBe('OPEN');
    expect(placed.body.blockedPaise).toBe(2 * limit + deliveryCharges('BUY', 2 * limit));
    expect(await newTrader.api.wallet()).toMatchObject({ blockedPaise: placed.body.blockedPaise });

    expect((await newTrader.api.cancelOrder(placed.body.id)).body.status).toBe('CANCELLED');
    expect(await newTrader.api.wallet()).toMatchObject({ balancePaise: WELCOME_BONUS_PAISE, blockedPaise: 0 });
    expect((await newTrader.api.cancelOrder(placed.body.id)).status).toBe(409);
  });

  test('a stop-loss sell triggers when the price falls and sells at the market price', async ({ market, newTrader }) => {
    const price = await market.pricedAt('ITC');
    await newTrader.api.buy('ITC', 4);
    const trigger = tick5(price * 0.97);
    const sl = await newTrader.api.placeOrder({ symbol: 'ITC', side: 'SELL', orderType: 'SL_M', qty: 4, triggerPricePaise: trigger });
    expect(sl.body.status).toBe('TRIGGER_PENDING');

    await market.setPrice('ITC', trigger - 15);
    const done = await newTrader.api.waitForOrderStatus(sl.body.id, 'EXECUTED');
    expect(done.fillPricePaise).toBe(trigger - 15);
  });

  test('the same Idempotency-Key places only one order', async ({ market, newTrader }) => {
    await market.pricedAt('TCS');
    const key = `ord-${Date.now()}`;
    const order = { symbol: 'TCS', side: 'BUY' as const, orderType: 'MARKET' as const, qty: 1 };
    const [a, b] = await Promise.all([newTrader.api.placeOrder(order, key), newTrader.api.placeOrder(order, key)]);
    expect(a.body.id).toBe(b.body.id);
    expect(await newTrader.api.orders()).toHaveLength(1);
  });

  test("another user's order looks like it doesn't exist (404)", async ({ market, api, newTrader }) => {
    await market.pricedAt('TCS');
    const mine = await newTrader.api.buy('TCS', 1);
    const other = api.as((await api.register({ fullName: 'Other', email: `other.${Date.now()}@example.com`, password: 'Secret123' })).accessToken);
    expect((await other.order(mine.id)).status).toBe(404);
    expect((await other.cancelOrder(mine.id)).status).toBe(404);
  });
});
