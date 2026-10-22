// API smoke test for Phase 1 (auth, profile/KYC, wallet ledger).
// Usage: start the API (npm run dev:api), then:  npm run test:api -w backend
// Creates throwaway users with unique emails, so it is safe to run repeatedly.

import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const run = Date.now().toString(36);
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition });
  console.log(`${condition ? '  PASS' : '  FAIL'}  ${name}${!condition && detail ? `  →  ${detail}` : ''}`);
}

/** Tiny HTTP client that remembers the refresh cookie like a browser would. */
function client() {
  const c = { token: null, cookie: null };
  c.call = async (method, path, body, headers = {}) => {
    const res = await fetch(API + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
        ...(c.cookie ? { Cookie: c.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      c.rawSetCookie = setCookie;
      const pair = setCookie.split(';')[0];
      c.cookie = pair.endsWith('=') ? null : pair;
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
  return c;
}

const msg = (r) => (Array.isArray(r.data?.message) ? r.data.message.join('; ') : r.data?.message ?? '');

async function main() {
  console.log(`\nSprout API smoke test → ${API}\n`);

  // ── Health & route protection ──────────────────────────────────────────
  console.log('Health & protection');
  const anon = client();
  const health = await anon.call('GET', '/health');
  check('health is ok with db up', health.status === 200 && health.data.db === 'up', JSON.stringify(health.data));
  check('instruments stay public', (await anon.call('GET', '/instruments?type=INDEX')).status === 200);
  check('GET /me without token → 401', (await anon.call('GET', '/me')).status === 401);
  check('GET /wallet without token → 401', (await anon.call('GET', '/wallet')).status === 401);
  const forged = client();
  forged.token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.invalidsignature';
  check('forged JWT → 401', (await forged.call('GET', '/me')).status === 401);

  // ── Registration ───────────────────────────────────────────────────────
  console.log('\nRegistration');
  const email = `Tester.${run}@Example.com`;
  const password = 'Secret123';
  const alice = client();
  check('bad email → 400', (await alice.call('POST', '/auth/register', { fullName: 'A', email: 'nope', password })).status === 400);
  const weak = await alice.call('POST', '/auth/register', { fullName: 'Alice', email: `w${run}@x.com`, password: 'abcdefgh' });
  check('password without a digit → 400', weak.status === 400 && /letter and one number/.test(msg(weak)), msg(weak));
  const extra = await alice.call('POST', '/auth/register', { fullName: 'Alice', email: `e${run}@x.com`, password, isAdmin: true });
  check('unknown field (isAdmin) rejected → 400', extra.status === 400, msg(extra));

  const reg = await alice.call('POST', '/auth/register', { fullName: '  Alice Tester ', email, password });
  alice.token = reg.data?.accessToken;
  check('register → 201 with access token', reg.status === 201 && !!alice.token, JSON.stringify(reg.data));
  check('email normalised to lowercase', reg.data?.user?.email === email.toLowerCase());
  check('new user starts with KYC PENDING', reg.data?.user?.kycStatus === 'PENDING');
  check('refresh cookie is httpOnly + SameSite=Strict + path /api/auth',
    /HttpOnly/i.test(alice.rawSetCookie) && /SameSite=Strict/i.test(alice.rawSetCookie) && /Path=\/api\/auth/i.test(alice.rawSetCookie),
    alice.rawSetCookie);
  const dup = await client().call('POST', '/auth/register', { fullName: 'Copy', email: email.toUpperCase(), password });
  check('duplicate email (different case) → 409', dup.status === 409, msg(dup));

  // ── Profile ────────────────────────────────────────────────────────────
  console.log('\nProfile');
  const me = await alice.call('GET', '/me');
  check('GET /me → own profile', me.status === 200 && me.data.fullName === 'Alice Tester');
  check('profile never exposes passwordHash/pan', !('passwordHash' in (me.data ?? {})) && !('pan' in (me.data ?? {})));
  check('invalid phone → 400', (await alice.call('PATCH', '/me', { phone: '12345' })).status === 400);
  const phone = await alice.call('PATCH', '/me', { phone: '9123456789' });
  check('valid phone saved', phone.status === 200 && phone.data.phone === '9123456789');

  // ── Wallet: welcome bonus, deposits, idempotency ──────────────────────
  console.log('\nWallet');
  const w0 = await alice.call('GET', '/wallet');
  check('welcome bonus ₹1,00,000 credited', w0.data?.balancePaise === 10_000_000, JSON.stringify(w0.data));
  const tx0 = await alice.call('GET', '/wallet/transactions');
  check('history shows WELCOME_BONUS', tx0.data?.items?.[0]?.type === 'WELCOME_BONUS');

  for (const [label, amountPaise] of [['zero', 0], ['below ₹1', 50], ['fractional paise', 150.5], ['above ₹10 lakh', 100_000_001], ['string', '500']]) {
    check(`deposit ${label} → 400`, (await alice.call('POST', '/wallet/deposit', { amountPaise })).status === 400);
  }

  const key = `dep-${run}-1`;
  const d1 = await alice.call('POST', '/wallet/deposit', { amountPaise: 500_000 }, { 'Idempotency-Key': key });
  check('deposit ₹5,000 → 201', d1.status === 201 && d1.data.balancePaise === 10_500_000, JSON.stringify(d1.data));
  const d2 = await alice.call('POST', '/wallet/deposit', { amountPaise: 500_000 }, { 'Idempotency-Key': key });
  check('same Idempotency-Key replayed → same transaction, no double credit',
    d2.data?.transactionId === d1.data?.transactionId && d2.data?.replayed === true && d2.data?.balancePaise === 10_500_000,
    JSON.stringify(d2.data));
  const d3 = await alice.call('POST', '/wallet/deposit', { amountPaise: 999_900 }, { 'Idempotency-Key': key });
  check('same key, different amount → 409', d3.status === 409, msg(d3));

  const raceKey = `dep-${run}-race`;
  const race = await Promise.all(
    Array.from({ length: 5 }, () => alice.call('POST', '/wallet/deposit', { amountPaise: 100_000 }, { 'Idempotency-Key': raceKey })),
  );
  const raceIds = new Set(race.map((r) => r.data?.transactionId));
  const afterRace = await alice.call('GET', '/wallet');
  check('5 parallel deposits with one key → exactly 1 transaction', raceIds.size === 1 && afterRace.data.balancePaise === 10_600_000,
    `ids=${raceIds.size} balance=${afterRace.data.balancePaise}`);

  // ── KYC ────────────────────────────────────────────────────────────────
  console.log('\nKYC');
  const preKyc = await alice.call('POST', '/wallet/withdraw', { amountPaise: 10_000 });
  check('withdraw before KYC → 403', preKyc.status === 403, msg(preKyc));
  check('bad PAN format → 400', (await alice.call('POST', '/me/kyc', { pan: '12345ABCDE', dateOfBirth: '1990-01-01' })).status === 400);
  const minor = new Date(); minor.setUTCFullYear(minor.getUTCFullYear() - 17);
  const under = await alice.call('POST', '/me/kyc', { pan: 'PQRST1234Z', dateOfBirth: minor.toISOString().slice(0, 10) });
  check('under 18 → 400', under.status === 400 && /18/.test(msg(under)), msg(under));
  check('impossible date 2001-02-30 → 400', (await alice.call('POST', '/me/kyc', { pan: 'PQRST1234Z', dateOfBirth: '2001-02-30' })).status === 400);
  const panTaken = await alice.call('POST', '/me/kyc', { pan: 'abcde1234f', dateOfBirth: '1990-01-01' });
  check("someone else's PAN (demo user's) → 409", panTaken.status === 409, msg(panTaken));
  const pan = `K${run.slice(-4).toUpperCase().replace(/[^A-Z]/g, 'X').padEnd(4, 'X')}${String(Date.now()).slice(-4)}Q`;
  const kyc = await alice.call('POST', '/me/kyc', { pan, dateOfBirth: '1992-08-20' });
  check('valid KYC → VERIFIED with masked PAN', kyc.status === 200 && kyc.data.kycStatus === 'VERIFIED' && kyc.data.panMasked === `XXXXXX${pan.slice(6)}`,
    `${kyc.status} ${JSON.stringify(kyc.data)}`);
  check('KYC twice → 409', (await alice.call('POST', '/me/kyc', { pan, dateOfBirth: '1992-08-20' })).status === 409);

  // ── Withdrawals & concurrency ─────────────────────────────────────────
  console.log('\nWithdrawals');
  const tooMuch = await alice.call('POST', '/wallet/withdraw', { amountPaise: 99_000_000 });
  check('withdraw more than balance → 422', tooMuch.status === 422, msg(tooMuch));
  const before = (await alice.call('GET', '/wallet')).data.balancePaise;
  const chunk = Math.floor(before * 0.3);
  const attempts = await Promise.all(Array.from({ length: 5 }, () => alice.call('POST', '/wallet/withdraw', { amountPaise: chunk })));
  const okCount = attempts.filter((r) => r.status === 201).length;
  const failCount = attempts.filter((r) => r.status === 422).length;
  const after = (await alice.call('GET', '/wallet')).data.balancePaise;
  check('5 simultaneous 30% withdrawals → exactly 3 succeed, 2 rejected', okCount === 3 && failCount === 2, `ok=${okCount} rejected=${failCount}`);
  check('balance never negative and exactly correct', after === before - 3 * chunk && after >= 0, `before=${before} after=${after}`);

  // ── Sessions: refresh rotation & logout ───────────────────────────────
  console.log('\nSessions');
  const oldCookie = alice.cookie;
  const r1 = await alice.call('POST', '/auth/refresh');
  check('refresh → new access token + rotated cookie', r1.status === 200 && !!r1.data.accessToken && alice.cookie !== oldCookie);
  alice.token = r1.data.accessToken;
  const thief = client(); thief.cookie = oldCookie;
  check('old (rotated) refresh token rejected → 401', (await thief.call('POST', '/auth/refresh')).status === 401);
  const r2 = await alice.call('POST', '/auth/refresh');
  check('current session still works after a replay inside grace window', r2.status === 200);
  alice.token = r2.data?.accessToken;
  const loggedOutCookie = alice.cookie;
  check('logout → 204', (await alice.call('POST', '/auth/logout')).status === 204);
  const afterLogout = client(); afterLogout.cookie = loggedOutCookie;
  check('refresh after logout → 401', (await afterLogout.call('POST', '/auth/refresh')).status === 401);

  // ── Login & lockout ───────────────────────────────────────────────────
  console.log('\nLogin & lockout');
  const bob = client();
  const unknown = await bob.call('POST', '/auth/login', { email: `ghost${run}@x.com`, password });
  const wrongPw = await bob.call('POST', '/auth/login', { email, password: 'Wrong1234' });
  check('unknown email and wrong password give the SAME 401 message', unknown.status === 401 && wrongPw.status === 401 && msg(unknown) === msg(wrongPw));
  check('correct login → 200', (await bob.call('POST', '/auth/login', { email: email.toUpperCase(), password })).status === 200);

  const victimEmail = `victim.${run}@example.com`;
  await client().call('POST', '/auth/register', { fullName: 'Victim', email: victimEmail, password });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await client().call('POST', '/auth/login', { email: victimEmail, password: 'Guess1234' })).status);
  check('5 wrong passwords → 401,401,401,401 then 423 Locked', codes.join(',') === '401,401,401,401,423', codes.join(','));
  const lockedRight = await client().call('POST', '/auth/login', { email: victimEmail, password });
  check('even the correct password is refused while locked → 423', lockedRight.status === 423, msg(lockedRight));
  check('demo user can log in', (await client().call('POST', '/auth/login', { email: 'demo@sprout.dev', password: 'Demo@1234' })).status === 200);

  // ── Ledger integrity (straight from the database) ─────────────────────
  console.log('\nLedger integrity');
  const prisma = new PrismaClient();
  try {
    const [{ total }] = await prisma.$queryRaw`SELECT COALESCE(SUM("amountPaise"), 0)::bigint AS total FROM ledger_entries`;
    check('all ledger entries ever written sum to exactly 0', total === 0n, `sum=${total}`);
    const unbalanced = await prisma.$queryRaw`
      SELECT "journalId" FROM ledger_entries GROUP BY "journalId" HAVING SUM("amountPaise") <> 0`;
    check('every journal is balanced', unbalanced.length === 0, `${unbalanced.length} unbalanced`);
    const drift = await prisma.$queryRaw`
      SELECT a.id FROM ledger_accounts a
      LEFT JOIN ledger_entries e ON e."accountId" = a.id
      GROUP BY a.id, a."balancePaise"
      HAVING a."balancePaise" <> COALESCE(SUM(e."amountPaise"), 0)`;
    check('every cached balance equals the sum of its entries', drift.length === 0, `${drift.length} accounts drifted`);
    const negative = await prisma.ledgerAccount.count({ where: { type: 'USER_CASH', balancePaise: { lt: 0 } } });
    check('no user account is negative', negative === 0);
  } finally {
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
