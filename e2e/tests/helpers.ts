import { APIRequestContext, expect, Page } from '@playwright/test';

/** Shared test helpers. Not a test file (Playwright only runs *.spec.ts). */

export const API = 'http://localhost:3000/api';

/** Rupees → "₹1,00,000.00", exactly like the app formats money. */
export const inr = (rupees: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(rupees);

/** Round paise to the ₹0.05 tick. */
export const tick5 = (paise: number) => Math.round(paise / 5) * 5;

/**
 * Charges on a delivery (CNC) stock trade, in paise — the published rates, written out
 * independently of the app so the test checks the app against the rules, not against itself.
 * STT 0.1% both sides, exchange 0.00297%, SEBI ₹10/crore, stamp duty 0.015% on buys,
 * GST 18% on (brokerage + exchange + SEBI). No brokerage on delivery. Each part rounded to the paisa.
 */
export function deliveryCharges(side: 'BUY' | 'SELL', valuePaise: number) {
  const part = (rate: number) => Math.round(valuePaise * rate);
  const stt = part(0.001);
  const exchange = part(0.0000297);
  const sebi = part(0.000001);
  const stamp = side === 'BUY' ? part(0.00015) : 0;
  const gst = Math.round((exchange + sebi) * 0.18);
  return stt + exchange + sebi + stamp + gst;
}

/** Today's date in India, YYYY-MM-DD. */
export const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Creates a brand-new user through the API (₹1,00,000 welcome money), logs in through the UI,
 * and returns the user's access token for API calls made on their behalf.
 */
export async function loginAsNewUser(page: Page, request: APIRequestContext) {
  const email = `pw.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'Secret123';
  const res = await request.post(`${API}/auth/register`, { data: { fullName: 'Playwright Trader', email, password } });
  expect(res.ok()).toBeTruthy();
  const { accessToken } = await res.json();

  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('index-strip')).toBeVisible();
  return accessToken as string;
}

/** Freezes the market and sets an exact price (paise) for a symbol. */
export async function setPrice(request: APIRequestContext, symbol: string, paise: number) {
  await request.post(`${API}/test/market/pause`);
  const res = await request.post(`${API}/test/market/price`, { data: { symbol, price: paise / 100 } });
  expect(res.ok()).toBeTruthy();
}

export async function prevClose(request: APIRequestContext, symbol: string) {
  return (await (await request.get(`${API}/market/quotes/${symbol}`)).json()).prevClosePaise as number;
}

/** Places a market order through the API (faster than clicking, for test setup). */
export async function marketOrder(request: APIRequestContext, token: string, symbol: string, side: 'BUY' | 'SELL', qty: number) {
  const res = await request.post(`${API}/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { symbol, side, orderType: 'MARKET', qty },
  });
  const order = await res.json();
  expect(order.status, JSON.stringify(order)).toBe('EXECUTED');
  return order;
}

/** Never leave the shared market paused or closed for the next test. */
export async function resetMarket(request: APIRequestContext) {
  await request.post(`${API}/test/market/session`, { data: { state: 'auto' } });
  await request.post(`${API}/test/market/resume`);
}
