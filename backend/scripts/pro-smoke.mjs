// Pro features smoke test (Phase 6): charges, stop-loss orders (SL, SL-M), GTT (single & OCO),
// index options (chain, pricing, buying, selling, expiry settlement).
// Usage: start the API, then:  npm run test:api -w backend   (needs ENABLE_TEST_HOOKS=true)
// Creates throwaway users. Pauses the shared market while running and resumes it at the end.

import { PrismaClient } from '@prisma/client';

const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';
const API = `${ORIGIN}/api`;
const run = Date.now().toString(36);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick5 = (paise) => Math.round(paise / 5) * 5;

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition });
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}${!condition && detail ? `  →  ${detail}` : ''}`);
}

async function http(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const msg = (r) => (Array.isArray(r.data?.message) ? r.data.message.join('; ') : r.data?.message ?? '');
const hook = (path, body = {}) => http('POST', `/test/${path}`, body);
const setPrice = (symbol, paise) => hook('market/price', { symbol, price: paise / 100 });
const quote = async (symbol) => (await http('GET', `/market/quotes/${symbol}`)).data;

async function newUser(name) {
  const r = await http('POST', '/auth/register', { fullName: name, email: `${name.toLowerCase()}.${run}@example.com`, password: 'Secret123' });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.data)}`);
  const token = r.data.accessToken;
  return {
    token,
    order: (body) => http('POST', '/orders', body, token),
    preview: (body) => http('POST', '/orders/preview', body, token),
    gtt: (body) => http('POST', '/gtt', body, token),
    get: (path) => http('GET', path, undefined, token),
    del: (path) => http('DELETE', path, undefined, token),
    wallet: async () => (await http('GET', '/wallet', undefined, token)).data,
    holding: async (symbol) => (await http('GET', '/portfolio/holdings', undefined, token)).data.holdings.find((h) => h.symbol === symbol),
  };
}

async function waitFor(fetchOnce, done, ms = 5000) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    last = await fetchOnce();
    if (done(last)) return last;
    await sleep(150);
  }
  return last;
}
const waitOrder = (u, id, status) => waitFor(async () => (await u.get(`/orders/${id}`)).data, (o) => o?.status === status);

// Independent copy of the charge rules (parts per crore), so the server is checked against the spec, not itself.
const ofValue = (v, rate) => Math.floor((2 * v * rate + 1e7) / 2e7);
function expectedCharges(segment, side, v) {
  const r = {
    DELIVERY: { brokerage: () => 0, sttBuy: 10000, sttSell: 10000, exch: 297, stamp: 1500 },
    INTRADAY: { brokerage: (x) => Math.min(2000, ofValue(x, 3000)), sttBuy: 0, sttSell: 2500, exch: 297, stamp: 300 },
    OPTIONS: { brokerage: (x) => Math.min(2000, x), sttBuy: 0, sttSell: 10000, exch: 3503, stamp: 300 },
  }[segment];
  const brokerage = r.brokerage(v);
  const stt = ofValue(v, side === 'BUY' ? r.sttBuy : r.sttSell);
  const exchange = ofValue(v, r.exch);
  const sebi = ofValue(v, 10);
  const stamp = side === 'BUY' ? ofValue(v, r.stamp) : 0;
  const gst = Math.floor((2 * (brokerage + exchange + sebi) * 18 + 100) / 200);
  return { brokeragePaise: brokerage, sttPaise: stt, exchangePaise: exchange, sebiPaise: sebi, stampDutyPaise: stamp, gstPaise: gst, totalPaise: brokerage + stt + exchange + sebi + stamp + gst };
}
const sameCharges = (a, b) => Object.keys(b).every((k) => a?.[k] === b[k]);

async function main() {
  console.log(`\nSprout pro features smoke test → ${API}\n`);
  const prisma = new PrismaClient();
  try {
    await hook('market/session', { state: 'auto' });
    await hook('market/pause');
    const u = await newUser('Meera');
    const tcs = await quote('TCS');
    const p = tick5(tcs.prevClosePaise);
    await setPrice('TCS', p);

    // ── Charges ──────────────────────────────────────────────────────────
    console.log('Charges');
    const pv = await u.preview({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 10 });
    const exp = expectedCharges('DELIVERY', 'BUY', 10 * p);
    check('preview: value = qty × live price', pv.status === 200 && pv.data.valuePaise === 10 * p, JSON.stringify(pv.data));
    check('preview: delivery buy charges match the published rates', sameCharges(pv.data.charges, exp), `${JSON.stringify(pv.data.charges)} vs ${JSON.stringify(exp)}`);
    check('preview: total = value + charges, places nothing', pv.data.totalPaise === 10 * p + exp.totalPaise && (await u.get('/orders')).data.length === 0);
    const intraBig = await u.preview({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 20, product: 'INTRADAY' });
    check('intraday brokerage is capped at ₹20', intraBig.data.charges.brokeragePaise === 2000, JSON.stringify(intraBig.data.charges));
    const intraSmall = await u.preview({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1, product: 'INTRADAY' });
    check('small intraday order: brokerage = 0.03%', sameCharges(intraSmall.data.charges, expectedCharges('INTRADAY', 'BUY', p)), JSON.stringify(intraSmall.data.charges));
    const sellPv = await u.preview({ symbol: 'TCS', side: 'SELL', orderType: 'LIMIT', qty: 10, limitPricePaise: p });
    check('sell preview: no stamp duty, total = value − charges', sellPv.data.charges.stampDutyPaise === 0 && sellPv.data.totalPaise === 10 * p - sellPv.data.charges.totalPaise);
    check('preview validates like placing (bad tick → 400)', (await u.preview({ symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 1, limitPricePaise: p + 1 })).status === 400);

    const cash0 = (await u.wallet()).balancePaise;
    const buy = await u.order({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 10 });
    check('executed buy charged exactly what the preview showed', buy.data.status === 'EXECUTED' && buy.data.chargesPaise === exp.totalPaise, JSON.stringify(buy.data));
    check('cash fell by value + charges', (await u.wallet()).balancePaise === cash0 - 10 * p - exp.totalPaise);

    // ── Stop-loss validation ─────────────────────────────────────────────
    console.log('\nStop-loss validation');
    const below = tick5(p * 0.97);
    const above = tick5(p * 1.03);
    for (const [label, body, pattern] of [
      ['SL without a trigger', { symbol: 'TCS', side: 'SELL', orderType: 'SL', qty: 1, limitPricePaise: below }, /triggerPricePaise is required/],
      ['SL without a limit', { symbol: 'TCS', side: 'SELL', orderType: 'SL', qty: 1, triggerPricePaise: below }, /limitPricePaise is required/],
      ['SL-M with a limit price', { symbol: 'TCS', side: 'SELL', orderType: 'SL_M', qty: 1, triggerPricePaise: below, limitPricePaise: below }, /only allowed/],
      ['MARKET with a trigger', { symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1, triggerPricePaise: above }, /only allowed/],
      ['stop-loss sell trigger above the price', { symbol: 'TCS', side: 'SELL', orderType: 'SL_M', qty: 1, triggerPricePaise: above }, /below the current price/],
      ['stop buy trigger below the price', { symbol: 'TCS', side: 'BUY', orderType: 'SL_M', qty: 1, triggerPricePaise: below }, /above the current price/],
      ['SL sell with limit above trigger', { symbol: 'TCS', side: 'SELL', orderType: 'SL', qty: 1, triggerPricePaise: below, limitPricePaise: below + 50 }, /at or below the trigger/],
      ['trigger off the tick size', { symbol: 'TCS', side: 'SELL', orderType: 'SL_M', qty: 1, triggerPricePaise: below + 2 }, /multiple of/],
    ]) {
      const r = await u.order(body);
      check(`${label} → 400`, r.status === 400 && pattern.test(msg(r)), `${r.status} ${msg(r)}`);
    }

    // ── SL-M sell: the classic stop-loss ─────────────────────────────────
    console.log('\nSL-M sell (protect a holding)');
    const slm = await u.order({ symbol: 'TCS', side: 'SELL', orderType: 'SL_M', qty: 4, triggerPricePaise: below });
    check('SL-M sell → TRIGGER_PENDING', slm.data?.status === 'TRIGGER_PENDING', JSON.stringify(slm.data));
    check('4 shares reserved for it', (await u.holding('TCS')).reservedQty === 4);
    await setPrice('TCS', tick5(p * 0.99));
    await sleep(500);
    check('price falls but stays above trigger → still waiting', (await u.get(`/orders/${slm.data.id}`)).data.status === 'TRIGGER_PENDING');
    const gap = below - 25; // price gaps through the trigger
    await setPrice('TCS', gap);
    const slmDone = await waitOrder(u, slm.data.id, 'EXECUTED');
    check('price reaches trigger → sells at the market price', slmDone?.status === 'EXECUTED' && slmDone.fillPricePaise === gap, JSON.stringify(slmDone));
    check('sell charges recorded', slmDone.chargesPaise === expectedCharges('DELIVERY', 'SELL', 4 * gap).totalPaise);
    let h = await u.holding('TCS');
    check('6 shares left, none reserved', h.qty === 6 && h.reservedQty === 0, JSON.stringify(h));

    // ── SL sell: limit protects against selling too low ──────────────────
    console.log('\nSL sell (trigger + limit)');
    await setPrice('TCS', p);
    const trig = tick5(p * 0.98);
    const lim = trig - 50;
    const sl = await u.order({ symbol: 'TCS', side: 'SELL', orderType: 'SL', qty: 2, triggerPricePaise: trig, limitPricePaise: lim });
    check('SL sell → TRIGGER_PENDING', sl.data?.status === 'TRIGGER_PENDING');
    await setPrice('TCS', lim - 30); // gaps below the limit: triggered, but can't sell that low
    const slOpen = await waitOrder(u, sl.data.id, 'OPEN');
    check('trigger hit but price below limit → becomes an OPEN limit order', slOpen?.status === 'OPEN', JSON.stringify(slOpen));
    await setPrice('TCS', lim);
    const slDone = await waitOrder(u, sl.data.id, 'EXECUTED');
    check('price recovers to the limit → fills', slDone?.status === 'EXECUTED' && slDone.fillPricePaise === lim, JSON.stringify(slDone));

    // ── Stop buy (breakout) ──────────────────────────────────────────────
    console.log('\nStop buy');
    await setPrice('TCS', p);
    const bt = tick5(p * 1.02);
    const bl = bt + 100;
    const cashB = (await u.wallet()).balancePaise;
    const sb = await u.order({ symbol: 'TCS', side: 'BUY', orderType: 'SL', qty: 3, triggerPricePaise: bt, limitPricePaise: bl });
    const blockExp = 3 * bl + expectedCharges('DELIVERY', 'BUY', 3 * bl).totalPaise;
    check('stop buy blocks limit × qty + charges', sb.data?.status === 'TRIGGER_PENDING' && sb.data.blockedPaise === blockExp, JSON.stringify(sb.data));
    await setPrice('TCS', bt);
    const sbDone = await waitOrder(u, sb.data.id, 'EXECUTED');
    check('price rises to trigger → buys', sbDone?.status === 'EXECUTED' && sbDone.fillPricePaise === bt, JSON.stringify(sbDone));
    const wB = await u.wallet();
    check('pays fill price + charges; rest of the block returned', wB.blockedPaise === 0 && wB.balancePaise === cashB - 3 * bt - sbDone.chargesPaise, JSON.stringify(wB));

    // ── Cancel & expiry of waiting stops ─────────────────────────────────
    console.log('\nCancel & expiry');
    await setPrice('TCS', p);
    const cashC = (await u.wallet()).balancePaise;
    const c1 = await u.order({ symbol: 'TCS', side: 'BUY', orderType: 'SL_M', qty: 1, triggerPricePaise: above });
    const c2 = await u.order({ symbol: 'TCS', side: 'SELL', orderType: 'SL_M', qty: 2, triggerPricePaise: below });
    check('cancel TRIGGER_PENDING buy → CANCELLED, money returned', (await u.del(`/orders/${c1.data.id}`)).data?.status === 'CANCELLED' && (await u.wallet()).balancePaise === cashC);
    await hook('orders/expire');
    check('end of day expires stop orders and frees shares', (await u.get(`/orders/${c2.data.id}`)).data.status === 'EXPIRED' && (await u.holding('TCS')).reservedQty === 0);

    // ── GTT ──────────────────────────────────────────────────────────────
    console.log('\nGTT');
    h = await u.holding('TCS');
    for (const [label, body, pattern] of [
      ['trigger within 0.25% of the price', { symbol: 'TCS', side: 'BUY', kind: 'SINGLE', qty: 1, triggerPricePaise: p + 5, limitPricePaise: p + 5 }, /0\.25%/],
      ['OCO to buy', { symbol: 'TCS', side: 'BUY', kind: 'OCO', qty: 1, triggerPricePaise: above, limitPricePaise: above, stopTriggerPricePaise: below, stopLimitPricePaise: below }, /side must be SELL/],
      ['OCO with the stop above the price', { symbol: 'TCS', side: 'SELL', kind: 'OCO', qty: 1, triggerPricePaise: above, limitPricePaise: above, stopTriggerPricePaise: above + 100, stopLimitPricePaise: above }, /below the current price/],
      ['sell more than you hold', { symbol: 'TCS', side: 'SELL', kind: 'SINGLE', qty: h.qty + 1, triggerPricePaise: above, limitPricePaise: above }, /hold only/],
      ['GTT on an index', { symbol: 'NIFTY', side: 'BUY', kind: 'SINGLE', qty: 1, triggerPricePaise: 100000, limitPricePaise: 100000 }, /stocks only/],
    ]) {
      const r = await u.gtt(body);
      check(`${label} → 400`, r.status === 400 && pattern.test(msg(r)), `${r.status} ${msg(r)}`);
    }
    const cashG = (await u.wallet()).balancePaise;
    const g1 = await u.gtt({ symbol: 'TCS', side: 'BUY', kind: 'SINGLE', qty: 2, triggerPricePaise: below, limitPricePaise: below + 50 });
    check('GTT buy below the price → ACTIVE, expires in a year', g1.status === 201 && g1.data.status === 'ACTIVE' &&
      Math.abs(Date.parse(g1.data.expiresAt) - Date.now() - 365 * 86_400_000) < 60_000, JSON.stringify(g1.data));
    check('a GTT blocks no money', (await u.wallet()).balancePaise === cashG);
    await hook('orders/expire');
    check('end of day does not touch GTTs', (await u.get('/gtt')).data.find((g) => g.id === g1.data.id).status === 'ACTIVE');
    await setPrice('TCS', below);
    const g1Done = await waitFor(async () => (await u.get('/gtt')).data.find((g) => g.id === g1.data.id), (g) => g?.status === 'TRIGGERED' && !!g.orderId);
    check('price falls to trigger → GTT TRIGGERED with an order', g1Done?.status === 'TRIGGERED' && g1Done.triggeredLeg === 'SINGLE' && !!g1Done.orderId, JSON.stringify(g1Done));
    const g1Order = (await u.get(`/orders/${g1Done.orderId}`)).data;
    check('…a LIMIT buy at the GTT limit, filled at the market price', g1Order.orderType === 'LIMIT' && g1Order.limitPricePaise === below + 50 &&
      g1Order.status === 'EXECUTED' && g1Order.fillPricePaise === below, JSON.stringify(g1Order));

    await setPrice('TCS', p);
    const qtyNow = (await u.holding('TCS')).qty;
    const oco = await u.gtt({ symbol: 'TCS', side: 'SELL', kind: 'OCO', qty: qtyNow, triggerPricePaise: above, limitPricePaise: above, stopTriggerPricePaise: below, stopLimitPricePaise: below - 100 });
    check('OCO sell (target above, stop-loss below) → ACTIVE', oco.data?.status === 'ACTIVE', JSON.stringify(oco.data));
    const spare = await u.gtt({ symbol: 'TCS', side: 'BUY', kind: 'SINGLE', qty: 1, triggerPricePaise: tick5(p * 0.9), limitPricePaise: tick5(p * 0.9) });
    check('cancel a GTT → CANCELLED', (await u.del(`/gtt/${spare.data.id}`)).data?.status === 'CANCELLED');
    check('cancel it again → 409', (await u.del(`/gtt/${spare.data.id}`)).status === 409);
    await setPrice('TCS', below - 20);
    const ocoDone = await waitFor(async () => (await u.get('/gtt')).data.find((g) => g.id === oco.data.id), (g) => g?.status === 'TRIGGERED' && !!g.orderId);
    check('price falls to the stop-loss → STOPLOSS leg fires (target leg ends with it)', ocoDone?.triggeredLeg === 'STOPLOSS', JSON.stringify(ocoDone));
    const ocoOrder = await waitOrder(u, ocoDone.orderId, 'EXECUTED');
    check('…all shares sold', ocoOrder?.status === 'EXECUTED' && !(await u.holding('TCS')), JSON.stringify(ocoOrder));
    await setPrice('TCS', above);
    await sleep(500);
    check('a fired OCO never fires again', (await u.get('/orders')).data.filter((o) => o.id === ocoDone.orderId).length === 1 &&
      (await u.get('/gtt')).data.find((g) => g.id === oco.data.id).status === 'TRIGGERED');
    const other = await newUser('Kabir');
    check("another user's GTT → 404", (await other.del(`/gtt/${g1.data.id}`)).status === 404);
    check('GTT list is private', (await other.get('/gtt')).data.length === 0);

    // ── Options ──────────────────────────────────────────────────────────
    console.log('\nOptions');
    const unds = (await http('GET', '/options/underlyings')).data;
    const nifty = unds.find((x) => x.symbol === 'NIFTY');
    check('NIFTY and BANKNIFTY have options', unds.length === 2 && nifty?.lotSize === 75 && nifty.expiries.length === 4, JSON.stringify(unds));
    const tue = nifty.expiries.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 2);
    check('NIFTY expiries are weekly Tuesdays', tue && Date.parse(nifty.expiries[1]) - Date.parse(nifty.expiries[0]) === 7 * 86_400_000, nifty.expiries.join(','));
    const bank = unds.find((x) => x.symbol === 'BANKNIFTY');
    const lastTue = bank.expiries.every((d) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 7); return x.getUTCDay() === 2 && x.getUTCDate() <= 7; });
    check('BANKNIFTY expiries are the last Tuesday of the month', lastTue, bank.expiries.join(','));

    const spot = tick5((await quote('NIFTY')).ltpPaise / 100) * 100; // a round price makes the ATM strike obvious
    const S = Math.round(spot / 5000) * 5000 + 1000; // ₹10 above a strike
    await setPrice('NIFTY', S);
    const expiry = nifty.expiries[0];
    const chain = (await http('GET', `/options/chain?underlying=NIFTY&expiry=${expiry}`)).data;
    const atm = S - 1000;
    check('chain: 31 strikes centred on the at-the-money strike', chain.rows?.length === 31 && chain.atmStrikePaise === atm && chain.rows[15].strikePaise === atm,
      `${chain.rows?.length} atm=${chain.atmStrikePaise}`);
    const calls = chain.rows.map((r) => r.call.ltpPaise);
    const puts = chain.rows.map((r) => r.put.ltpPaise);
    check('call premiums fall as the strike rises; put premiums rise', calls.every((c, i) => i === 0 || c <= calls[i - 1]) && puts.every((x, i) => i === 0 || x >= puts[i - 1]));
    const row = chain.rows[15];
    check('deltas: call 0…1, put −1…0, ATM call near 0.5', row.call.delta > 0.4 && row.call.delta < 0.65 && row.put.delta < 0 && row.put.delta > -0.6, `${row.call.delta} ${row.put.delta}`);
    const T = (Date.parse(`${expiry}T15:30:00+05:30`) - Date.now()) / (365 * 86_400_000);
    const parity = (row.call.ltpPaise - row.put.ltpPaise) / 100 - (S / 100 - (atm / 100) * Math.exp(-0.065 * T));
    check('put-call parity: call − put = spot − strike × discount', Math.abs(parity) < 0.15, `diff ₹${parity.toFixed(3)}`);
    check('theta is negative (options lose value each day)', row.call.theta < 0 && row.put.theta < 0);
    check('unknown underlying → 404, bad expiry → 400', (await http('GET', '/options/chain?underlying=TCS')).status === 404 &&
      (await http('GET', '/options/chain?underlying=NIFTY&expiry=2020-01-07')).status === 400);

    const callSym = row.call.symbol;
    for (const [label, body, pattern] of [
      ['qty not a multiple of the lot (75)', { symbol: callSym, side: 'BUY', orderType: 'MARKET', qty: 10 }, /lot size \(75\)/],
      ['strike far from the price', { symbol: chain.rows[15].call.symbol.replace(String(atm / 100), String(atm / 100 + 2000)), side: 'BUY', orderType: 'MARKET', qty: 75 }, /too far/],
      ['strike off the ₹50 grid', { symbol: callSym.replace(String(atm / 100), String(atm / 100 + 10)), side: 'BUY', orderType: 'MARKET', qty: 75 }, /multiples of/],
      ['expiry that is not listed', { symbol: callSym.replace(expiry.slice(2).replace(/-/g, ''), '991231'), side: 'BUY', orderType: 'MARKET', qty: 75 }, /no contract expiring/],
    ]) {
      const r = await u.order(body);
      check(`${label} → 400`, r.status === 400 && pattern.test(msg(r)), `${r.status} ${msg(r)}`);
    }
    const notHeld = await u.order({ symbol: row.put.symbol, side: 'SELL', orderType: 'MARKET', qty: 75 });
    check("selling an option you don't hold → REJECTED (no naked selling)", notHeld.data?.status === 'REJECTED' && /don't hold this option/.test(notHeld.data.statusReason), JSON.stringify(notHeld.data));

    const optPv = (await u.preview({ symbol: callSym, side: 'BUY', orderType: 'MARKET', qty: 75 })).data;
    check('option preview: ₹20 flat brokerage, charges on the premium', optPv.charges.brokeragePaise === 2000 && sameCharges(optPv.charges, expectedCharges('OPTIONS', 'BUY', 75 * row.call.ltpPaise)),
      JSON.stringify(optPv.charges));
    const cashO = (await u.wallet()).balancePaise;
    const ob = await u.order({ symbol: callSym, side: 'BUY', orderType: 'MARKET', qty: 75 });
    check('buy 1 lot of the ATM call → EXECUTED at the chain price', ob.data?.status === 'EXECUTED' && ob.data.fillPricePaise === row.call.ltpPaise, JSON.stringify(ob.data));
    check('paid premium × 75 + charges', (await u.wallet()).balancePaise === cashO - 75 * row.call.ltpPaise - ob.data.chargesPaise);
    let pos = (await u.get('/portfolio/options')).data;
    check('position listed with name, lot and Greeks', pos.length === 1 && pos[0].qty === 75 && pos[0].lotSize === 75 && pos[0].name.startsWith('NIFTY ') && pos[0].delta > 0, JSON.stringify(pos[0]));
    await setPrice('NIFTY', S + 10000); // index +₹100
    pos = (await u.get('/portfolio/options')).data;
    check('index rises ₹100 → call position gains', pos[0].pnlPaise > 0 && pos[0].ltpPaise > row.call.ltpPaise, JSON.stringify(pos[0]));
    const os = await u.order({ symbol: callSym, side: 'SELL', orderType: 'MARKET', qty: 75 });
    check('sell to close → EXECUTED, realised P&L recorded', os.data?.status === 'EXECUTED' && (await u.get('/portfolio/options')).data.length === 0, JSON.stringify(os.data));

    // Expiry settlement: buy a call and a put, then settle at a known index price.
    await setPrice('NIFTY', S);
    const putSym = chain.rows[16].put.symbol; // strike atm + 50: in the money for a put
    await u.order({ symbol: callSym, side: 'BUY', orderType: 'MARKET', qty: 150 });
    await u.order({ symbol: putSym, side: 'BUY', orderType: 'MARKET', qty: 75 });
    const waitingSell = await u.order({ symbol: callSym, side: 'SELL', orderType: 'LIMIT', qty: 75, limitPricePaise: 999995 });
    const settleAt = atm + 3000; // index ₹30 above the call strike, ₹20 below the put strike
    await setPrice('NIFTY', settleAt);
    const cashS = (await u.wallet()).balancePaise;
    const settled = await hook('options/settle', { expiry });
    check('settlement hook settles both positions', settled.data?.settled === 2, JSON.stringify(settled.data));
    check('waiting orders on the contract expire', (await u.get(`/orders/${waitingSell.data.id}`)).data.status === 'EXPIRED');
    check('positions closed', (await u.get('/portfolio/options')).data.length === 0);
    check('cash credited intrinsic value: call ₹30 × 150 + put ₹20 × 75 (no charges)', (await u.wallet()).balancePaise === cashS + 3000 * 150 + 2000 * 75);
    const settleOrders = (await u.get('/orders')).data.filter((o) => /Settled at expiry/.test(o.statusReason ?? ''));
    check('settlement shows as executed sells in the order book', settleOrders.length === 2 && settleOrders.every((o) => o.side === 'SELL' && o.status === 'EXECUTED'));

    // ── Invariants ───────────────────────────────────────────────────────
    console.log('\nDatabase invariants');
    const [{ total }] = await prisma.$queryRaw`SELECT COALESCE(SUM("amountPaise"), 0)::bigint AS total FROM ledger_entries`;
    check('all ledger entries sum to exactly 0', total === 0n, `sum=${total}`);
    const blockedMismatch = await prisma.$queryRaw`
      SELECT a."userId" FROM ledger_accounts a
      LEFT JOIN orders o ON o."userId" = a."userId" AND o.status IN ('OPEN', 'TRIGGER_PENDING')
      WHERE a.type = 'USER_BLOCKED'
      GROUP BY a."userId", a."balancePaise" HAVING a."balancePaise" <> COALESCE(SUM(o."blockedPaise"), 0)`;
    check("blocked balance = money held by waiting orders (incl. stop orders)", blockedMismatch.length === 0);
    const negative = await prisma.ledgerAccount.count({ where: { type: { in: ['USER_CASH', 'USER_BLOCKED'] }, balancePaise: { lt: 0 } } });
    check('no user cash/blocked account is negative', negative === 0);
  } finally {
    await hook('market/session', { state: 'auto' }).catch(() => {});
    await hook('market/resume').catch(() => {});
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
