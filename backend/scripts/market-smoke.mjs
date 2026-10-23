// Market data smoke test (Phase 2): quotes, price rules, candles, WebSocket stream, test hooks.
// Usage: start the API (npm run dev:api), then:  npm run test:api -w backend
// Needs ENABLE_TEST_HOOKS=true. Leaves the market resumed and in automatic session mode.

import { io } from 'socket.io-client';

const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';
const API = `${ORIGIN}/api`;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition });
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}${!condition && detail ? `  →  ${detail}` : ''}`);
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
const get = (path) => call('GET', path);
const post = (path, body) => call('POST', path, body ?? {});

/** Resolves with the first event matching `predicate` within `ms`, else null. */
function waitForEvent(socket, event, predicate = () => true, ms = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { socket.off(event, handler); resolve(null); }, ms);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

async function main() {
  console.log(`\nSprout market smoke test → ${API}\n`);
  let socket;
  try {
    // ── Health & status ───────────────────────────────────────────────────
    console.log('Health & status');
    const health = await get('/health');
    check('health: db and redis up', health.data?.db === 'up' && health.data?.redis === 'up', JSON.stringify(health.data));
    const status = await get('/market/status');
    check('market status is open (always mode)', status.data?.open === true && status.data?.mode === 'always', JSON.stringify(status.data));

    // ── Quotes ────────────────────────────────────────────────────────────
    console.log('\nQuotes');
    const quotes = (await get('/market/quotes')).data;
    check('quotes for all 53 instruments', Array.isArray(quotes) && quotes.length === 53, `got ${quotes?.length}`);
    const equities = quotes.filter((q) => q.upperCircuitPaise !== null);
    const indices = quotes.filter((q) => q.upperCircuitPaise === null);
    check('50 equities have circuit limits, 3 indices do not', equities.length === 50 && indices.length === 3);
    const badTick = equities.filter((q) => q.ltpPaise % 5 !== 0);
    check('every equity price is a multiple of ₹0.05', badTick.length === 0, badTick.map((q) => q.symbol).join(','));
    const outside = equities.filter((q) => q.ltpPaise > q.upperCircuitPaise || q.ltpPaise < q.lowerCircuitPaise);
    check('every equity price is inside its ±10% circuit band', outside.length === 0, outside.map((q) => q.symbol).join(','));
    const badRange = quotes.filter((q) => q.lowPaise > q.ltpPaise || q.highPaise < q.ltpPaise);
    check('low ≤ last price ≤ high for every quote', badRange.length === 0, badRange.map((q) => q.symbol).join(','));
    const rel = quotes.find((q) => q.symbol === 'RELIANCE');
    check('circuit = prev close ±10%', rel.upperCircuitPaise === Math.floor((rel.prevClosePaise * 1.1) / 5) * 5,
      `prev=${rel.prevClosePaise} upper=${rel.upperCircuitPaise}`);
    check('GET /market/quotes/reliance (any case) → 200', (await get('/market/quotes/reliance')).data?.symbol === 'RELIANCE');
    check('unknown symbol quote → 404', (await get('/market/quotes/NOPE')).status === 404);

    const before = (await get('/market/quotes/TCS')).data;
    await sleep(2200);
    const after = (await get('/market/quotes/TCS')).data;
    check('prices update every tick', after.updatedAt > before.updatedAt, `${before.updatedAt} → ${after.updatedAt}`);

    // ── Candles ───────────────────────────────────────────────────────────
    console.log('\nCandles');
    const day = (await get('/market/candles/INFY?range=1D')).data;
    const increasing = day.points.every((p, i) => i === 0 || p.t > day.points[i - 1].t);
    check('1D: 200+ one-minute points, strictly increasing time', day.points.length >= 200 && increasing, `n=${day.points.length}`);
    for (const range of ['1W', '1M', '1Y', '5Y']) {
      const r = await get(`/market/candles/INFY?range=${range}`);
      check(`${range}: returns history`, r.status === 200 && r.data.points.length >= 100, `${r.status} n=${r.data?.points?.length}`);
    }
    const y1 = (await get('/market/candles/INFY?range=1Y')).data.points;
    const y2 = (await get('/market/candles/INFY?range=1Y')).data.points;
    check('history is stable between requests (seeded)', y1[10].v === y2[10].v);
    check('invalid range → 400', (await get('/market/candles/INFY?range=2D')).status === 400);
    check('unknown symbol candles → 404', (await get('/market/candles/NOPE')).status === 404);

    // ── Fundamentals ──────────────────────────────────────────────────────
    const inst = (await get('/instruments/RELIANCE')).data;
    check('instrument has fundamentals from the DB', inst.peRatio === 28.4 && inst.marketCapCr === 1990000, JSON.stringify(inst));

    // ── WebSocket ─────────────────────────────────────────────────────────
    console.log('\nWebSocket');
    socket = io(ORIGIN, { transports: ['websocket'], reconnection: false });
    const statusEvt = waitForEvent(socket, 'status');
    const snapshotEvt = waitForEvent(socket, 'snapshot');
    const firstTick = waitForEvent(socket, 'ticks');
    check('receives status on connect', (await statusEvt)?.open === true);
    check('receives snapshot of 53 quotes on connect', (await snapshotEvt)?.length === 53);
    check('receives live ticks', (await firstTick)?.length === 53);

    // ── Test hooks ────────────────────────────────────────────────────────
    console.log('\nTest hooks');
    const paused = await post('/test/market/pause');
    check('pause → status paused', paused.data?.paused === true);
    const frozen1 = (await get('/market/quotes/HDFCBANK')).data;
    await sleep(2200);
    const frozen2 = (await get('/market/quotes/HDFCBANK')).data;
    check('while paused, prices do not move', frozen1.updatedAt === frozen2.updatedAt && frozen1.ltpPaise === frozen2.ltpPaise);

    const prev = rel.prevClosePaise;
    const target = Math.round((prev * 1.02) / 5) * 5 / 100; // +2%, on a ₹0.05 tick
    const pushed = waitForEvent(socket, 'ticks', (qs) => qs.find((q) => q.symbol === 'RELIANCE')?.ltpPaise === Math.round(target * 100));
    const set = await post('/test/market/price', { symbol: 'reliance', price: target });
    check('set exact price → applied', set.data?.ltpPaise === Math.round(target * 100), JSON.stringify(set.data));
    check('the new price is pushed to WebSocket clients', !!(await pushed));
    // toFixed: plain `target + 0.03` gives float noise like 3004.4400000000005, which the API rightly rejects.
    const odd = await post('/test/market/price', { symbol: 'RELIANCE', price: Number((target + 0.03).toFixed(2)) });
    check('price is rounded to the ₹0.05 tick', odd.status === 200 && odd.data.ltpPaise % 5 === 0, `${odd.status} ${JSON.stringify(odd.data)}`);
    const floaty = await post('/test/market/price', { symbol: 'RELIANCE', price: 0.1 + 0.2 });
    check('more than 2 decimal places (0.1 + 0.2 = 0.30000000000000004) → 400', floaty.status === 400);
    const crazy = await post('/test/market/price', { symbol: 'RELIANCE', price: (prev / 100) * 5 });
    check('price above circuit is capped at upper circuit', crazy.data?.ltpPaise === rel.upperCircuitPaise, `${crazy.data?.ltpPaise}`);
    check('bad body → 400', (await post('/test/market/price', { symbol: 'RELIANCE', price: -5 })).status === 400);

    const closedEvt = waitForEvent(socket, 'status', (s) => s.open === false);
    const closed = await post('/test/market/session', { state: 'closed' });
    check('session closed → status closed', closed.data?.open === false);
    check('clients are told the market closed', !!(await closedEvt));
    await post('/test/market/session', { state: 'auto' });
    await post('/test/market/resume');
    const resumedTick = await waitForEvent(socket, 'ticks');
    check('after resume + auto session, ticks flow again', !!resumedTick);
  } finally {
    // Never leave the shared market frozen or closed.
    await post('/test/market/session', { state: 'auto' }).catch(() => {});
    await post('/test/market/resume').catch(() => {});
    socket?.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
