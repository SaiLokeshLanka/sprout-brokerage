import { expect, test } from '../../src/fixtures';
import { uniquePan, WELCOME_BONUS_PAISE } from '../../src/data/users';

test.describe('Wallet API', () => {
  test('a new account starts with the welcome bonus', async ({ newTrader }) => {
    expect(await newTrader.api.wallet()).toEqual({ balancePaise: WELCOME_BONUS_PAISE, blockedPaise: 0, currency: 'INR' });
  });

  test('deposit adds money and appears in the history', async ({ newTrader }) => {
    const res = await newTrader.api.call('POST', '/wallet/deposit', { data: { amountPaise: 250_050 } });
    expect(res.status).toBe(201);
    expect(res.body.balancePaise).toBe(WELCOME_BONUS_PAISE + 250_050);

    const history = await newTrader.api.call('GET', '/wallet/transactions');
    expect(history.body.items[0]).toMatchObject({ type: 'DEPOSIT', amountPaise: 250_050 });
  });

  test('the same Idempotency-Key never deposits twice', async ({ newTrader }) => {
    const key = { 'Idempotency-Key': `dep-${Date.now()}` };
    const first = await newTrader.api.call('POST', '/wallet/deposit', { data: { amountPaise: 100_000 }, headers: key });
    const retry = await newTrader.api.call('POST', '/wallet/deposit', { data: { amountPaise: 100_000 }, headers: key });
    expect(retry.body.transactionId).toBe(first.body.transactionId);
    expect(retry.body.replayed).toBe(true);
    expect((await newTrader.api.wallet()).balancePaise).toBe(WELCOME_BONUS_PAISE + 100_000);

    const different = await newTrader.api.call('POST', '/wallet/deposit', { data: { amountPaise: 999 }, headers: key });
    expect(different.status).toBe(409);
  });

  const badAmounts = [
    { amount: 0, why: 'zero' },
    { amount: -500, why: 'negative' },
    { amount: 10.5, why: 'a fraction of a paisa' },
    { amount: 100_000_001, why: 'over ₹10,00,000' },
  ];
  for (const { amount, why } of badAmounts) {
    test(`deposit of ${why} → 400`, async ({ newTrader }) => {
      expect((await newTrader.api.call('POST', '/wallet/deposit', { data: { amountPaise: amount } })).status).toBe(400);
    });
  }

  test('withdrawals need KYC (403), then work up to the balance', async ({ newTrader }) => {
    const blocked = await newTrader.api.call('POST', '/wallet/withdraw', { data: { amountPaise: 1000 } });
    expect(blocked.status).toBe(403);

    await newTrader.api.verifyKyc(uniquePan());
    const ok = await newTrader.api.call('POST', '/wallet/withdraw', { data: { amountPaise: 1000 } });
    expect(ok.status).toBe(201);
    const tooMuch = await newTrader.api.call('POST', '/wallet/withdraw', { data: { amountPaise: WELCOME_BONUS_PAISE } });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.message).toBe('Insufficient balance');
  });
});
