import { expect, test } from '../../src/fixtures';
import { tick5 } from '../../src/utils/money';

test.describe('GTT API', () => {
  test('a single GTT waits (blocking nothing), then places a limit order when triggered', async ({ market, newTrader }) => {
    const price = await market.pricedAt('TCS');
    const trigger = tick5(price * 0.96);
    const created = await newTrader.api.createGtt({ symbol: 'TCS', side: 'BUY', kind: 'SINGLE', qty: 2, triggerPricePaise: trigger, limitPricePaise: trigger });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('ACTIVE');
    expect((await newTrader.api.wallet()).blockedPaise).toBe(0);

    // End of day expires normal orders, never GTTs.
    await market.expireOrders();
    expect((await newTrader.api.gtts())[0].status).toBe('ACTIVE');

    await market.setPrice('TCS', trigger);
    await expect.poll(async () => (await newTrader.api.gtts())[0].orderId).toBeTruthy();
    const gtt = (await newTrader.api.gtts())[0];
    expect(gtt).toMatchObject({ status: 'TRIGGERED', triggeredLeg: 'SINGLE' });
    expect((await newTrader.api.order(gtt.orderId!)).body).toMatchObject({ orderType: 'LIMIT', status: 'EXECUTED' });
  });

  const invalid = [
    { name: 'a trigger within 0.25% of the price', gtt: (p: number) => ({ kind: 'SINGLE', side: 'BUY', triggerPricePaise: p + 5, limitPricePaise: p }), message: /0\.25%/ },
    { name: 'an OCO buy', gtt: (p: number) => ({ kind: 'OCO', side: 'BUY', triggerPricePaise: tick5(p * 1.1), limitPricePaise: tick5(p * 1.1), stopTriggerPricePaise: tick5(p * 0.9), stopLimitPricePaise: tick5(p * 0.9) }), message: /side must be SELL/ },
    { name: 'selling shares you do not hold', gtt: (p: number) => ({ kind: 'SINGLE', side: 'SELL', triggerPricePaise: tick5(p * 1.1), limitPricePaise: tick5(p * 1.1) }), message: /don't hold/ },
  ];
  for (const row of invalid) {
    test(`a GTT with ${row.name} → 400`, async ({ market, newTrader }) => {
      const price = await market.pricedAt('TCS');
      const res = await newTrader.api.createGtt({ symbol: 'TCS', qty: 1, ...row.gtt(price) });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(row.message);
    });
  }

  test('an OCO fires only one leg, once', async ({ market, newTrader }) => {
    const price = await market.pricedAt('INFY');
    await newTrader.api.buy('INFY', 3);
    const target = tick5(price * 1.04);
    const created = await newTrader.api.createGtt({
      symbol: 'INFY', side: 'SELL', kind: 'OCO', qty: 3,
      triggerPricePaise: target, limitPricePaise: target,
      stopTriggerPricePaise: tick5(price * 0.96), stopLimitPricePaise: tick5(price * 0.95),
    });
    expect(created.status).toBe(201);

    await market.setPrice('INFY', target);
    await expect.poll(async () => (await newTrader.api.gtts())[0].orderId).toBeTruthy();
    expect((await newTrader.api.gtts())[0].triggeredLeg).toBe('TARGET');

    await market.setPrice('INFY', tick5(price * 0.9)); // the stop-loss price is now crossed too…
    await new Promise((r) => setTimeout(r, 1_000)); // give the server's matcher time to (wrongly) act
    expect(await newTrader.api.orders()).toHaveLength(2); // …but there is no third order (1 buy + 1 sell)
  });

  test('cancel: ACTIVE → CANCELLED, again → 409, another user → 404', async ({ market, api, newTrader }) => {
    const price = await market.pricedAt('TCS');
    const gtt = (await newTrader.api.createGtt({ symbol: 'TCS', side: 'BUY', kind: 'SINGLE', qty: 1, triggerPricePaise: tick5(price * 0.9), limitPricePaise: tick5(price * 0.9) })).body;
    const other = api.as((await api.register({ fullName: 'Other', email: `other.${Date.now()}@example.com`, password: 'Secret123' })).accessToken);

    expect((await other.cancelGtt(gtt.id)).status).toBe(404);
    expect((await newTrader.api.cancelGtt(gtt.id)).body.status).toBe('CANCELLED');
    expect((await newTrader.api.cancelGtt(gtt.id)).status).toBe(409);
  });
});
