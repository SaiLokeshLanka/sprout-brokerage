import { expect, test } from '../../src/fixtures';
import { API_URL } from '../../src/config';
import { newUserData } from '../../src/data/users';

test.describe('Auth API', () => {
  test('register → 201 with an access token, the user, and an httpOnly refresh cookie', { tag: '@smoke' }, async ({ api }) => {
    const user = newUserData({ fullName: 'Ravi Kumar' });
    const res = await api.call('POST', '/auth/register', { data: user });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      user: { email: user.email, fullName: 'Ravi Kumar', kycStatus: 'PENDING' },
    });
    expect(res.body.user).not.toHaveProperty('passwordHash'); // never leak secrets
    const cookie = res.headers['set-cookie'];
    expect(cookie).toContain('sprout_rt=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth');
  });

  test('registering the same email twice → 409', async ({ api, newTrader }) => {
    const res = await api.call('POST', '/auth/register', { data: newUserData({ email: newTrader.email }) });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('An account with this email already exists');
  });

  // Data-driven tests: one test per row, each with its own name in the report.
  const invalidSignups = [
    { name: 'short password', change: { password: 'Ab1' }, message: 'Password must be at least 8 characters' },
    { name: 'password without a number', change: { password: 'abcdefgh' }, message: 'Password must contain at least one letter and one number' },
    { name: 'bad email', change: { email: 'not-an-email' }, message: /email/i },
    { name: 'empty name', change: { fullName: '' }, message: /name/i },
  ];
  for (const row of invalidSignups) {
    test(`register with ${row.name} → 400`, async ({ api }) => {
      const res = await api.call('POST', '/auth/register', { data: newUserData(row.change) });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toMatch(row.message);
    });
  }

  test('wrong password → 401 with the same message as an unknown email (no account enumeration)', async ({ api, newTrader }) => {
    const wrong = await api.call('POST', '/auth/login', { data: { email: newTrader.email, password: 'Wrong1234' } });
    const unknown = await api.call('POST', '/auth/login', { data: { email: 'nobody.at.all@example.com', password: 'Wrong1234' } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  test('5 wrong passwords lock the account (423), even for the right password', async ({ api, newTrader }) => {
    for (let i = 0; i < 5; i++) await api.call('POST', '/auth/login', { data: { email: newTrader.email, password: 'Wrong1234' } });
    const locked = await api.call('POST', '/auth/login', { data: { email: newTrader.email, password: newTrader.password } });
    expect(locked.status).toBe(423);
  });

  test('protected endpoints need a valid token', async ({ api, newTrader }) => {
    expect((await api.call('GET', '/me')).status).toBe(401);
    expect((await api.as('not-a-real-token').call('GET', '/me')).status).toBe(401);
    const me = await newTrader.api.call('GET', '/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(newTrader.email);
  });

  test('refresh rotates the cookie; logout ends the session', async ({ playwright, newTrader }) => {
    // A request context keeps cookies between calls, like a browser.
    const ctx = await playwright.request.newContext();
    try {
      await ctx.post(`${API_URL}/auth/login`, { data: { email: newTrader.email, password: newTrader.password } });
      const before = (await ctx.storageState()).cookies.find((c) => c.name === 'sprout_rt')!.value;

      const refreshed = await ctx.post(`${API_URL}/auth/refresh`);
      expect(refreshed.status()).toBe(200);
      expect((await refreshed.json()).accessToken).toEqual(expect.any(String));
      const after = (await ctx.storageState()).cookies.find((c) => c.name === 'sprout_rt')!.value;
      expect(after).not.toBe(before);

      expect((await ctx.post(`${API_URL}/auth/logout`)).status()).toBeLessThan(300);
      expect((await ctx.post(`${API_URL}/auth/refresh`)).status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });
});
