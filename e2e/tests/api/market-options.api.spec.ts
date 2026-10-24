import { expect, test } from '../../src/fixtures';

test.describe('Market data API', () => {
  test('a quote has the price, previous close and a ±10% circuit band on the tick size', async ({ api }) => {
    const q = await api.quote('RELIANCE');
    expect(q).toMatchObject({ symbol: 'RELIANCE', ltpPaise: expect.any(Number), prevClosePaise: expect.any(Number) });
    expect(q.ltpPaise % 5).toBe(0);
    expect(q.upperCircuitPaise! / q.prevClosePaise).toBeCloseTo(1.1, 2);
    expect(q.lowerCircuitPaise! / q.prevClosePaise).toBeCloseTo(0.9, 2);
    expect(q.ltpPaise).toBeGreaterThanOrEqual(q.lowerCircuitPaise!);
    expect(q.ltpPaise).toBeLessThanOrEqual(q.upperCircuitPaise!);
  });

  test('OHLC candles are consistent: low ≤ open, close ≤ high', async ({ api }) => {
    const res = await api.call<{ candles: { t: number; o: number; h: number; l: number; c: number; vol: number }[] }>('GET', '/market/candles/INFY?range=1M&format=ohlc');
    expect(res.status).toBe(200);
    expect(res.body.candles.length).toBeGreaterThan(50);
    for (const c of res.body.candles) {
      expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c));
      expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c));
    }
    const times = res.body.candles.map((c) => c.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times); // oldest first
  });

  test('an unknown symbol → 404; a bad range → 400', async ({ api }) => {
    expect((await api.call('GET', '/market/quotes/NOPE')).status).toBe(404);
    expect((await api.call('GET', '/market/candles/TCS?range=2D')).status).toBe(400);
  });
});

test.describe('Options API', () => {
  test('the chain is centred on the at-the-money strike, with sensible prices and Greeks', async ({ market, api }) => {
    const { ltpPaise } = await api.quote('NIFTY');
    const atm = Math.round(ltpPaise / 5000) * 5000;
    await market.setPrice('NIFTY', atm + 1000);
    const chain = await api.optionChain('NIFTY');

    expect(chain.rows).toHaveLength(31);
    expect(chain.atmStrikePaise).toBe(atm);
    expect(chain.lotSize).toBe(75);
    const calls = chain.rows.map((r) => r.call.ltpPaise);
    const puts = chain.rows.map((r) => r.put.ltpPaise);
    expect(calls).toEqual([...calls].sort((a, b) => b - a)); // calls get cheaper as the strike rises
    expect(puts).toEqual([...puts].sort((a, b) => a - b)); // puts get dearer
    for (const r of chain.rows) {
      expect(r.call.delta).toBeGreaterThanOrEqual(0);
      expect(r.call.delta).toBeLessThanOrEqual(1);
      expect(r.put.delta).toBeLessThanOrEqual(0);
      expect(r.call.theta).toBeLessThanOrEqual(0); // time decay
    }
  });

  test('expiries are Tuesdays: weekly for NIFTY, last Tuesday of the month for BANKNIFTY', async ({ api }) => {
    const { body } = await api.call<{ symbol: string; expiries: string[] }[]>('GET', '/options/underlyings');
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    const nifty = body.find((u) => u.symbol === 'NIFTY')!.expiries;
    expect(nifty.every((d) => day(d).getUTCDay() === 2)).toBe(true);
    expect(day(nifty[1]).getTime() - day(nifty[0]).getTime()).toBe(7 * 86_400_000);
    for (const d of body.find((u) => u.symbol === 'BANKNIFTY')!.expiries) {
      const nextWeek = day(d);
      nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
      expect(nextWeek.getUTCMonth()).not.toBe(day(d).getUTCMonth()); // no later Tuesday in that month
    }
  });

  test('options trade in whole lots, can only be sold if held, and settle at intrinsic value', async ({ market, api, newTrader }) => {
    const { ltpPaise } = await api.quote('NIFTY');
    const strike = Math.round(ltpPaise / 5000) * 5000;
    await market.setPrice('NIFTY', strike + 2000); // index ₹20 above the strike
    const chain = await api.optionChain('NIFTY');
    const { call, put } = chain.rows.find((r) => r.strikePaise === strike)!;

    const partLot = await newTrader.api.placeOrder({ symbol: call.symbol, side: 'BUY', orderType: 'MARKET', qty: 10 });
    expect(partLot.status).toBe(400);
    expect(partLot.body.message).toMatch(/lot size \(75\)/);

    const naked = await newTrader.api.placeOrder({ symbol: put.symbol, side: 'SELL', orderType: 'MARKET', qty: 75 });
    expect(naked.body).toMatchObject({ status: 'REJECTED', statusReason: "You don't hold this option" });

    const bought = await newTrader.api.buy(call.symbol, 75);
    const cashAfterBuy = (await newTrader.api.wallet()).balancePaise;
    expect((await newTrader.api.optionPositions())[0]).toMatchObject({ symbol: call.symbol, qty: 75 });
    expect(bought.chargesPaise).toBeGreaterThan(2000); // ₹20 brokerage + taxes

    await market.settleOptions(chain.expiry);
    expect(await newTrader.api.optionPositions()).toHaveLength(0);
    expect((await newTrader.api.wallet()).balancePaise).toBe(cashAfterBuy + 2000 * 75); // ₹20 × 75 units, no charges
  });
});
