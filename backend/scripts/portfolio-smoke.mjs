// Portfolio & reports smoke test (Phase 4): valuation, day P&L, realised P&L, allocation,
// trade book, P&L report, statement, contract note, CSV exports, date validation.
// Usage: start the API, then:  npm run test:api -w backend   (needs ENABLE_TEST_HOOKS=true)

const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';
const API = `${ORIGIN}/api`;
const run = Date.now().toString(36);
const results = [];
const tick5 = (paise) => Math.round(paise / 5) * 5;
const rupees = (paise) => (paise / 100).toFixed(2);

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
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* CSV or plain text */ }
  return { status: res.status, data, text, headers: res.headers };
}
const hook = (path, body = {}) => http('POST', `/test/${path}`, body);
const setPrice = (symbol, paise) => hook('market/price', { symbol, price: paise / 100 });

async function newUser(name) {
  const r = await http('POST', '/auth/register', { fullName: name, email: `${name.toLowerCase()}.${run}@example.com`, password: 'Secret123' });
  const token = r.data.accessToken;
  return {
    token,
    get: (path) => http('GET', path, undefined, token),
    buy: (symbol, qty) => http('POST', '/orders', { symbol, side: 'BUY', orderType: 'MARKET', qty }, token),
    sell: (symbol, qty) => http('POST', '/orders', { symbol, side: 'SELL', orderType: 'MARKET', qty }, token),
  };
}

// IST calendar date, like the server uses.
const istDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function main() {
  console.log(`\nSprout portfolio smoke test → ${API}\n`);
  try {
    await hook('market/session', { state: 'auto' });
    await hook('market/pause');
    const u = await newUser('Priya');
    const START = 100_000 * 100;

    const prev = async (s) => (await http('GET', `/market/quotes/${s}`)).data.prevClosePaise;
    const tcs0 = await prev('TCS');
    const infy0 = await prev('INFY');
    const rel0 = await prev('RELIANCE');
    // Buy ABOVE yesterday's close: a naive day-P&L (vs previous close) would show a loss/gain here.
    const t1 = tick5(tcs0 * 1.01);
    const i1 = tick5(infy0 * 1.005);
    const r1 = tick5(rel0);
    await setPrice('TCS', t1);
    await setPrice('INFY', i1);
    await setPrice('RELIANCE', r1);
    await u.buy('TCS', 4);
    await u.buy('INFY', 10);
    await u.buy('RELIANCE', 2);
    const invested = 4 * t1 + 10 * i1 + 2 * r1;

    // ── Valuation at the buy price ───────────────────────────────────────
    console.log('Valuation');
    let s = (await u.get('/portfolio/summary')).data;
    check('invested = what was paid', s.totals.investedPaise === invested, `${s.totals.investedPaise} vs ${invested}`);
    check('current value = qty × live price', s.totals.currentValuePaise === invested);
    check('unrealised P&L is 0 at the buy price', s.totals.pnlPaise === 0);
    check("shares bought today: day P&L is 0 (measured from buy price, not yesterday's close)", s.totals.dayPnlPaise === 0,
      `dayPnl=${s.totals.dayPnlPaise}; prevClose-based would be ${4 * (t1 - tcs0) + 10 * (i1 - infy0)}`);
    check('cash = start − invested', s.cashPaise === START - invested);
    check('net worth = cash + blocked + shares', s.totals.netWorthPaise === s.cashPaise + s.blockedPaise + s.totals.currentValuePaise);

    // ── Price moves ──────────────────────────────────────────────────────
    const t2 = tick5(tcs0 * 1.03);
    await setPrice('TCS', t2);
    s = (await u.get('/portfolio/summary')).data;
    const tcs = s.holdings.find((h) => h.symbol === 'TCS');
    check('TCS unrealised P&L = 4 × (new − buy)', tcs.pnlPaise === 4 * (t2 - t1), `${tcs.pnlPaise}`);
    check('TCS day P&L = 4 × (new − buy)', tcs.dayPnlPaise === 4 * (t2 - t1));
    check('day P&L = qty × ltp − dayBasis (clients can recompute live)', tcs.qty * tcs.ltpPaise - tcs.dayBasisPaise === tcs.dayPnlPaise);
    check('P&L % = P&L / invested', Math.abs(tcs.pnlPct - (100 * (t2 - t1)) / t1) < 0.01, `${tcs.pnlPct}`);
    check('holding carries name and sector from the instrument master', tcs.name === 'Tata Consultancy Services' && tcs.sector === 'IT');

    // ── Realised P&L ─────────────────────────────────────────────────────
    console.log('\nRealised P&L');
    await u.sell('TCS', 1);
    s = (await u.get('/portfolio/summary')).data;
    check('sell 1 TCS: realised today = sale − average cost', s.totals.realizedTodayPaise === t2 - t1, `${s.totals.realizedTodayPaise}`);
    check('realised all-time matches', s.totals.realizedPnlPaise === t2 - t1);
    check('TCS holding now 3 shares', s.holdings.find((h) => h.symbol === 'TCS').qty === 3);
    check('net worth = start + unrealised + realised (no money appears or disappears)',
      s.totals.netWorthPaise === START + s.totals.pnlPaise + s.totals.realizedPnlPaise,
      `${s.totals.netWorthPaise} vs ${START + s.totals.pnlPaise + s.totals.realizedPnlPaise}`);

    // ── Allocation ───────────────────────────────────────────────────────
    console.log('\nAllocation');
    const sectors = s.allocation.map((a) => a.sector);
    check('allocation grouped by sector (IT, Oil & Gas)', sectors.includes('IT') && sectors.includes('Oil & Gas') && sectors.length === 2, sectors.join(','));
    check('allocation adds up to 100%', Math.abs(s.allocation.reduce((t, a) => t + a.pct, 0) - 100) < 0.05);
    check('allocation values add up to current value', s.allocation.reduce((t, a) => t + a.valuePaise, 0) === s.totals.currentValuePaise);

    // ── Trade book ───────────────────────────────────────────────────────
    console.log('\nTrade book');
    const book = (await u.get('/portfolio/trades')).data;
    check('4 trades, newest first', book.trades.length === 4 && book.trades[0].side === 'SELL', book.trades.map((t) => t.side).join(','));
    check('default range = this financial year to today', book.from.endsWith('-04-01') && book.to === istDate());
    check('filter by symbol', (await u.get('/portfolio/trades?symbol=tcs')).data.trades.length === 2);

    // ── P&L report ───────────────────────────────────────────────────────
    console.log('\nP&L report');
    const pnl = (await u.get('/reports/pnl')).data;
    const tRow = pnl.rows.find((r) => r.symbol === 'TCS');
    check('TCS row: bought 4, sold 1, realised = sale − cost', tRow.buyQty === 4 && tRow.sellQty === 1 && tRow.realizedPnlPaise === t2 - t1, JSON.stringify(tRow));
    check('totals: turnover = buys + sells', pnl.totals.turnoverPaise === invested + t2);
    check('totals: realised = sum of rows', pnl.totals.realizedPnlPaise === pnl.rows.reduce((t, r) => t + r.realizedPnlPaise, 0));
    const yesterday = istDate(-1);
    check('a range without trades is empty', (await u.get(`/reports/pnl?from=${yesterday}&to=${yesterday}`)).data.rows.length === 0);

    // ── Date validation ──────────────────────────────────────────────────
    console.log('\nDate validation');
    for (const [label, q] of [
      ['not a date format', 'from=24-10-2026'],
      ['impossible date', 'from=2026-02-30'],
      ['from after to', `from=${istDate()}&to=${yesterday}`],
      ['more than 5 years', 'from=2015-01-01&to=2026-01-01'],
    ]) {
      const r = await u.get(`/reports/pnl?${q}`);
      check(`${label} → 400`, r.status === 400, `${r.status} ${JSON.stringify(r.data)}`);
    }

    // ── Statement ────────────────────────────────────────────────────────
    console.log('\nStatement');
    const st = (await u.get(`/reports/statement?from=${istDate()}&to=${istDate()}`)).data;
    check('opening balance 0 for a new account', st.openingBalancePaise === 0);
    check('first entry is the welcome bonus', st.items[0]?.type === 'WELCOME_BONUS');
    check('closing balance = current cash', st.closingBalancePaise === s.cashPaise);
    check('credits − debits = closing − opening', st.creditsPaise - st.debitsPaise === st.closingBalancePaise - st.openingBalancePaise);
    check('a range before the account existed is empty', (await u.get('/reports/statement?from=2024-01-01&to=2024-01-31')).data.items.length === 0);

    // ── Contract note ────────────────────────────────────────────────────
    console.log('\nContract note');
    const cn = (await u.get(`/reports/contract-note?date=${istDate()}`)).data;
    check("today's contract note lists all 4 trades", cn.trades?.length === 4);
    check('net = sells − buys', cn.totals.netPaise === t2 - invested);
    check('client details and note number', cn.client.name === 'Priya' && /^CN-\d{8}-[A-Z0-9]{8}$/.test(cn.noteNumber), JSON.stringify(cn.client));
    check('date with no trades → empty note', (await u.get(`/reports/contract-note?date=${yesterday}`)).data.trades.length === 0);
    check('missing date → 400', (await u.get('/reports/contract-note')).status === 400);

    // ── CSV exports ──────────────────────────────────────────────────────
    console.log('\nCSV exports');
    const pc = await u.get('/reports/pnl.csv');
    check('P&L CSV: text/csv + attachment filename', /text\/csv/.test(pc.headers.get('content-type')) && /attachment; filename="sprout-pnl-/.test(pc.headers.get('content-disposition')),
      `${pc.headers.get('content-type')} | ${pc.headers.get('content-disposition')}`);
    const lines = pc.text.trim().split('\r\n');
    check('P&L CSV: header row, CRLF line endings', lines[0].startsWith('Symbol,Name,Trades') && pc.text.includes('\r\n'));
    check('P&L CSV: TCS row has realised P&L in rupees', lines.some((l) => l.startsWith('TCS,') && l.endsWith(`,${rupees(t2 - t1)}`)), lines.join(' | '));
    check('P&L CSV: name with comma-free text, TOTAL row last', lines[lines.length - 1].startsWith('TOTAL'));
    const tc = await u.get('/reports/trades.csv');
    check('trades CSV: header + 4 rows', tc.text.trim().split('\r\n').length === 5);
    const sc = await u.get('/reports/statement.csv');
    const sl = sc.text.trim().split('\r\n');
    check('statement CSV: opening and closing rows', sl[1].includes('OPENING') && sl[sl.length - 1].includes('CLOSING'));
    check('statement CSV: closing balance matches cash', sl[sl.length - 1].endsWith(`,${rupees(s.cashPaise)}`), sl[sl.length - 1]);

    // ── Access ───────────────────────────────────────────────────────────
    console.log('\nAccess');
    check('summary without login → 401', (await http('GET', '/portfolio/summary')).status === 401);
    check('CSV without login → 401', (await http('GET', '/reports/pnl.csv')).status === 401);
    const other = await newUser('Ravi');
    const os = (await other.get('/portfolio/summary')).data;
    check("another user sees only their own (empty) portfolio", os.holdings.length === 0 && os.totals.netWorthPaise === START);
  } finally {
    await hook('market/resume').catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
