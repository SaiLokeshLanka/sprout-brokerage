// Orders smoke test (Phase 3, charges since Phase 6): placing, filling, cancelling and expiring orders,
// money & shares through the ledger (every trade also pays its charges), races, private WebSocket updates, DB invariants.
// Usage: start the API, then:  npm run test:api -w backend   (needs ENABLE_TEST_HOOKS=true)
// Creates throwaway users. Pauses the shared market while running and resumes it at the end.

import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';

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

async function http(method, path, body, token, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
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

async function newUser(name) {
  const r = await http('POST', '/auth/register', { fullName: name, email: `${name.toLowerCase()}.${run}@example.com`, password: 'Secret123' });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.data)}`);
  const token = r.data.accessToken;
  const api = {
    token,
    id: r.data.user.id,
    order: (body, headers) => http('POST', '/orders', body, token, headers),
    get: (path) => http('GET', path, undefined, token),
    del: (path) => http('DELETE', path, undefined, token),
    wallet: async () => (await http('GET', '/wallet', undefined, token)).data,
    holding: async (symbol) => (await http('GET', '/portfolio/holdings', undefined, token)).data.holdings.find((h) => h.symbol === symbol),
    portfolio: async () => (await http('GET', '/portfolio/holdings', undefined, token)).data,
  };
  return api;
}

async function waitForStatus(user, orderId, status, ms = 5000) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    last = (await user.get(`/orders/${orderId}`)).data;
    if (last?.status === status) return last;
    await sleep(150);
  }
  return last;
}

async function main() {
  console.log(`\nSprout orders smoke test → ${API}\n`);
  const prisma = new PrismaClient();
  const sockets = [];
  try {
    await hook('market/session', { state: 'auto' });
    await hook('market/pause'); // deterministic prices: they only move when we set them

    const alice = await newUser('Alice');
    const tcs = (await http('GET', '/market/quotes/TCS')).data;
    const p0 = tick5(tcs.prevClosePaise);
    await setPrice('TCS', p0);
    const cash0 = (await alice.wallet()).balancePaise;

    // ── Market buy ────────────────────────────────────────────────────────
    console.log('Market buy');
    const mb = await alice.order({ symbol: 'tcs', side: 'BUY', orderType: 'MARKET', qty: 2 });
    check('market BUY 2 TCS → 201 EXECUTED at the market price', mb.status === 201 && mb.data.status === 'EXECUTED' && mb.data.fillPricePaise === p0, JSON.stringify(mb.data));
    let w = await alice.wallet();
    check('the trade paid charges (STT, stamp duty, exchange fee...)', mb.data.chargesPaise > 0, JSON.stringify(mb.data));
    check('wallet cash debited by exactly 2 × price + charges', w.balancePaise === cash0 - 2 * p0 - mb.data.chargesPaise, `${cash0} → ${w.balancePaise}`);
    let h = await alice.holding('TCS');
    check('holding: 2 TCS at average = fill price', h?.qty === 2 && h.avgPricePaise === p0, JSON.stringify(h));
    const txns = (await alice.get('/wallet/transactions')).data.items;
    check('wallet history shows the TRADE_BUY and its CHARGES', txns.some((t) => t.type === 'TRADE_BUY' && t.amountPaise === -2 * p0) &&
      txns.some((t) => t.type === 'CHARGES' && t.amountPaise === -mb.data.chargesPaise), JSON.stringify(txns.slice(0, 2)));

    // ── Input validation (400, nothing recorded) ─────────────────────────
    console.log('\nValidation');
    const before = (await alice.get('/orders')).data.length;
    const bad = [
      ['index cannot be traded', { symbol: 'NIFTY', side: 'BUY', orderType: 'MARKET', qty: 1 }, /Indices/],
      ['unknown symbol', { symbol: 'NOPE', side: 'BUY', orderType: 'MARKET', qty: 1 }, /Unknown/],
      ['qty 0', { symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 0 }, /at least 1/],
      ['fractional qty', { symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1.5 }, /whole number/],
      ['limit price off the ₹0.05 tick', { symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 1, limitPricePaise: p0 + 3 }, /multiple of/],
      ['limit price outside the circuit band', { symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 1, limitPricePaise: tick5(tcs.prevClosePaise * 1.5) }, /price band/],
      ['LIMIT without a price', { symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 1 }, /required/],
      ['MARKET with a price', { symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1, limitPricePaise: p0 }, /only allowed/],
      ['unknown field', { symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1, price: 5 }, /should not exist/],
    ];
    for (const [label, body, pattern] of bad) {
      const r = await alice.order(body);
      check(`${label} → 400`, r.status === 400 && pattern.test(msg(r)), `${r.status} ${msg(r)}`);
    }
    check('invalid orders are not recorded', (await alice.get('/orders')).data.length === before);
    check('no login → 401', (await http('POST', '/orders', { symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1 })).status === 401);

    // ── Limit buy: block, then fill below the limit ──────────────────────
    console.log('\nLimit buy');
    const lim = tick5(p0 * 0.98);
    const cashBefore = (await alice.wallet()).balancePaise;
    const lb = await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 3, limitPricePaise: lim });
    check('limit BUY below market → OPEN', lb.data?.status === 'OPEN', JSON.stringify(lb.data));
    w = await alice.wallet();
    check('3 × limit price + charges moved from cash to blocked', lb.data.blockedPaise > 3 * lim && w.balancePaise === cashBefore - lb.data.blockedPaise &&
      w.blockedPaise === lb.data.blockedPaise, JSON.stringify(w));
    const fillAt = lim - 5;
    await setPrice('TCS', fillAt);
    const filled = await waitForStatus(alice, lb.data.id, 'EXECUTED');
    check('price drops below limit → order fills at the better market price', filled?.status === 'EXECUTED' && filled.fillPricePaise === fillAt, JSON.stringify(filled));
    w = await alice.wallet();
    check('blocked released; unused part refunded to cash', w.blockedPaise === 0 && w.balancePaise === cashBefore - 3 * fillAt - filled.chargesPaise, JSON.stringify(w));
    h = await alice.holding('TCS');
    check('holding: 5 TCS with correct average price', h.qty === 5 && h.investedPaise === 2 * p0 + 3 * fillAt, JSON.stringify(h));

    // ── Cancel ───────────────────────────────────────────────────────────
    console.log('\nCancel');
    const cashC = (await alice.wallet()).balancePaise;
    const lc = await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 1, limitPricePaise: tick5(fillAt * 0.95) });
    const cancelled = await alice.del(`/orders/${lc.data.id}`);
    check('cancel OPEN order → CANCELLED', cancelled.status === 200 && cancelled.data.status === 'CANCELLED', JSON.stringify(cancelled.data));
    w = await alice.wallet();
    check('cancel returns blocked money to cash', w.balancePaise === cashC && w.blockedPaise === 0, JSON.stringify(w));
    check('cancel twice → 409', (await alice.del(`/orders/${lc.data.id}`)).status === 409);
    check('cancel an executed order → 409', (await alice.del(`/orders/${mb.data.id}`)).status === 409);
    check('cancel with a malformed id → 400', (await alice.del('/orders/not-a-uuid')).status === 400);

    // ── Sell ─────────────────────────────────────────────────────────────
    console.log('\nSell');
    const high = tick5(fillAt * 1.03);
    const ls = await alice.order({ symbol: 'TCS', side: 'SELL', orderType: 'LIMIT', qty: 4, limitPricePaise: high });
    check('limit SELL above market → OPEN', ls.data?.status === 'OPEN');
    h = await alice.holding('TCS');
    check('4 of 5 shares reserved', h.reservedQty === 4, JSON.stringify(h));
    const over = await alice.order({ symbol: 'TCS', side: 'SELL', orderType: 'MARKET', qty: 2 });
    check('selling reserved shares → REJECTED "at most 1"', over.data?.status === 'REJECTED' && /at most 1/.test(over.data.statusReason), JSON.stringify(over.data));
    const avg = h.avgPricePaise;
    const ms = await alice.order({ symbol: 'TCS', side: 'SELL', orderType: 'MARKET', qty: 1 });
    check('market SELL 1 → EXECUTED', ms.data?.status === 'EXECUTED', JSON.stringify(ms.data));
    await setPrice('TCS', high);
    const sold = await waitForStatus(alice, ls.data.id, 'EXECUTED');
    check('price rises to limit → reserved shares sold', sold?.status === 'EXECUTED' && sold.fillPricePaise === high, JSON.stringify(sold));
    const pf = await alice.portfolio();
    check('all 5 sold → holding gone', !pf.holdings.find((x) => x.symbol === 'TCS'));
    const expectRealized = Math.round(fillAt + 4 * high - 5 * avg);
    check('realised P&L = proceeds − average cost', Math.abs(pf.realizedPnlPaise - expectRealized) <= 1, `${pf.realizedPnlPaise} vs ${expectRealized}`);
    const wSell = await alice.wallet();
    check('sale proceeds minus charges credited to cash', wSell.balancePaise === cashC + fillAt + 4 * high - ms.data.chargesPaise - sold.chargesPaise, `${wSell.balancePaise}`);

    // ── Risk rejections (recorded as REJECTED) ───────────────────────────
    console.log('\nRejections');
    const rich = await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 100000 });
    check('buy worth more than cash → REJECTED "Insufficient funds"', rich.data?.status === 'REJECTED' && rich.data.statusReason === 'Insufficient funds');
    check('…and no money moved', (await alice.wallet()).balancePaise === wSell.balancePaise);
    const notHeld = await alice.order({ symbol: 'INFY', side: 'SELL', orderType: 'MARKET', qty: 1 });
    check("sell a stock you don't own → REJECTED", notHeld.data?.status === 'REJECTED' && /don't hold/.test(notHeld.data.statusReason));

    // ── Market close & expiry ────────────────────────────────────────────
    console.log('\nMarket close & expiry');
    const cashE = (await alice.wallet()).balancePaise;
    const waiting = await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 2, limitPricePaise: tick5(high * 0.95) });
    await hook('market/session', { state: 'closed' });
    const exp = await waitForStatus(alice, waiting.data.id, 'EXPIRED');
    check('market close expires open orders', exp?.status === 'EXPIRED', JSON.stringify(exp));
    check('expiry returns blocked money', (await alice.wallet()).balancePaise === cashE);
    const closed = await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1 });
    check('order while closed → REJECTED "Market is closed"', closed.data?.status === 'REJECTED' && closed.data.statusReason === 'Market is closed');
    await hook('market/session', { state: 'auto' });
    await sleep(1200); // let the simulator see the session reopen
    const eod = await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 1, limitPricePaise: tick5(high * 0.95) });
    const exp2 = await hook('orders/expire');
    check('end-of-day hook expires open orders', exp2.data?.expired >= 1 && (await alice.get(`/orders/${eod.data.id}`)).data.status === 'EXPIRED');

    // ── Idempotency ──────────────────────────────────────────────────────
    console.log('\nIdempotency');
    const key = { 'Idempotency-Key': `ord-${run}-1` };
    const i1 = await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1 }, key);
    const i2 = await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 1 }, key);
    check('same Idempotency-Key twice → one order', i1.data?.id === i2.data?.id && (await alice.holding('TCS'))?.qty === 1);
    check('same key, different order → 409', (await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'MARKET', qty: 2 }, key)).status === 409);

    // ── Races ────────────────────────────────────────────────────────────
    console.log('\nRaces');
    const bob = await newUser('Bob');
    const rel = (await http('GET', '/market/quotes/RELIANCE')).data;
    const pr = tick5(rel.prevClosePaise);
    await setPrice('RELIANCE', pr);
    const bobCash = (await bob.wallet()).balancePaise;
    const q = Math.floor((bobCash * 0.3) / pr);
    const buys = await Promise.all(Array.from({ length: 5 }, () => bob.order({ symbol: 'RELIANCE', side: 'BUY', orderType: 'MARKET', qty: q })));
    const okBuys = buys.filter((r) => r.data?.status === 'EXECUTED').length;
    check('5 simultaneous buys of 30% of cash → exactly 3 execute', okBuys === 3 && buys.filter((r) => r.data?.status === 'REJECTED').length === 2,
      buys.map((r) => r.data?.status).join(','));
    const bobCharges = buys.filter((r) => r.data?.status === 'EXECUTED').reduce((t, r) => t + r.data.chargesPaise, 0);
    check('cash never negative', (await bob.wallet()).balancePaise === bobCash - 3 * q * pr - bobCharges);
    const sells = await Promise.all(Array.from({ length: 4 }, () => bob.order({ symbol: 'RELIANCE', side: 'SELL', orderType: 'MARKET', qty: q })));
    check('holding 3q, 4 simultaneous sells of q → exactly 3 execute', sells.filter((r) => r.data?.status === 'EXECUTED').length === 3,
      sells.map((r) => r.data?.status).join(','));

    // ── Privacy ──────────────────────────────────────────────────────────
    console.log('\nPrivacy');
    check("another user's order → 404", (await bob.get(`/orders/${mb.data.id}`)).status === 404);
    check("cancelling another user's order → 404", (await bob.del(`/orders/${eod.data.id}`)).status === 404);
    check("order list shows only your orders", (await bob.get('/orders')).data.every((o) => o.symbol === 'RELIANCE'));

    // ── Private WebSocket ────────────────────────────────────────────────
    console.log('\nAccount WebSocket');
    const anon = io(`${ORIGIN}/account`, { transports: ['websocket'], reconnection: false });
    sockets.push(anon);
    const rejected = await new Promise((resolve) => {
      anon.on('auth_error', () => resolve(true));
      anon.on('disconnect', () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });
    check('no token → disconnected', rejected);

    const sock = io(`${ORIGIN}/account`, { transports: ['websocket'], reconnection: false, auth: { token: alice.token } });
    sockets.push(sock);
    await new Promise((resolve) => sock.on('connect', resolve));
    await sleep(200); // room join happens right after connect
    const wsLimit = tick5(p0 * 0.97);
    const pending = await alice.order({ symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', qty: 1, limitPricePaise: wsLimit });
    const pushed = new Promise((resolve) => {
      sock.on('order', (o) => o.id === pending.data.id && o.status === 'EXECUTED' && resolve(o));
      setTimeout(() => resolve(null), 4000);
    });
    await setPrice('TCS', wsLimit);
    check('owner gets a live "order EXECUTED" event', !!(await pushed));

    // ── Database invariants ──────────────────────────────────────────────
    console.log('\nDatabase invariants');
    const [{ total }] = await prisma.$queryRaw`SELECT COALESCE(SUM("amountPaise"), 0)::bigint AS total FROM ledger_entries`;
    check('all ledger entries sum to exactly 0', total === 0n, `sum=${total}`);
    const drift = await prisma.$queryRaw`
      SELECT a.id FROM ledger_accounts a LEFT JOIN ledger_entries e ON e."accountId" = a.id
      GROUP BY a.id, a."balancePaise" HAVING a."balancePaise" <> COALESCE(SUM(e."amountPaise"), 0)`;
    check('every cached balance equals the sum of its entries', drift.length === 0);
    const negative = await prisma.ledgerAccount.count({ where: { type: { in: ['USER_CASH', 'USER_BLOCKED'] }, balancePaise: { lt: 0 } } });
    check('no user cash/blocked account is negative', negative === 0);
    const blockedMismatch = await prisma.$queryRaw`
      SELECT a."userId" FROM ledger_accounts a
      LEFT JOIN orders o ON o."userId" = a."userId" AND o.status IN ('OPEN', 'TRIGGER_PENDING')
      WHERE a.type = 'USER_BLOCKED'
      GROUP BY a."userId", a."balancePaise" HAVING a."balancePaise" <> COALESCE(SUM(o."blockedPaise"), 0)`;
    check("each user's blocked balance = money held by their open orders", blockedMismatch.length === 0, `${blockedMismatch.length} users`);
    const reservedMismatch = await prisma.$queryRaw`
      SELECT h.id FROM holdings h
      LEFT JOIN orders o ON o."userId" = h."userId" AND o.symbol = h.symbol AND o.status IN ('OPEN', 'TRIGGER_PENDING') AND o.side = 'SELL'
      GROUP BY h.id, h."reservedQty" HAVING h."reservedQty" <> COALESCE(SUM(o.qty), 0)`;
    check('reserved shares = shares in open sell orders', reservedMismatch.length === 0);
    const qtyMismatch = await prisma.$queryRaw`
      SELECT h.id FROM holdings h
      LEFT JOIN trades t ON t."userId" = h."userId" AND t.symbol = h.symbol
      GROUP BY h.id, h.qty HAVING h.qty <> COALESCE(SUM(CASE WHEN t.side = 'BUY' THEN t.qty ELSE -t.qty END), 0)`;
    check('holding qty = shares bought − shares sold', qtyMismatch.length === 0);
    const badHold = await prisma.$queryRaw`SELECT id FROM holdings WHERE "reservedQty" > qty OR qty < 0 OR "totalCostPaise" < 0`;
    check('no holding has negative or over-reserved shares', badHold.length === 0);
    const [{ charged }] = await prisma.$queryRaw`SELECT COALESCE(SUM("chargesPaise"), 0)::bigint AS charged FROM trades`;
    const chargesAccount = await prisma.ledgerAccount.findUnique({ where: { id: 'system-charges' } });
    check('charges account balance = charges recorded on all trades', chargesAccount?.balancePaise === charged, `${chargesAccount?.balancePaise} vs ${charged}`);
  } finally {
    sockets.forEach((s) => s.close());
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
