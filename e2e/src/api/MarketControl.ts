import { APIRequestContext, expect } from '@playwright/test';
import { API_URL } from '../config';
import { tick5 } from '../utils/money';

/**
 * Controls the simulated market through the server's test hooks (/api/test/*), so tests are
 * repeatable: freeze prices, set an exact price, open or close the market, end the day.
 * The hooks only exist when the API runs with ENABLE_TEST_HOOKS=true.
 *
 * The market is shared by every test, so the `market` fixture calls reset() after each test.
 */
export class MarketControl {
  constructor(private readonly request: APIRequestContext) {}

  private async hook(path: string, data: unknown = {}) {
    const res = await this.request.post(`${API_URL}/test/${path}`, { data });
    expect(res.ok(), `test hook ${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  pause() {
    return this.hook('market/pause');
  }

  resume() {
    return this.hook('market/resume');
  }

  open() {
    return this.hook('market/session', { state: 'open' });
  }

  close() {
    return this.hook('market/session', { state: 'closed' });
  }

  /** Freezes the market and sets an exact price (paise). */
  async setPrice(symbol: string, paise: number) {
    await this.pause();
    await this.hook('market/price', { symbol, price: paise / 100 });
    return paise;
  }

  async prevClose(symbol: string): Promise<number> {
    const res = await this.request.get(`${API_URL}/market/quotes/${symbol}`);
    return (await res.json()).prevClosePaise;
  }

  /**
   * Freezes the market and sets the price to yesterday's close × factor, on the ₹0.05 tick.
   * Staying near yesterday's close keeps the price inside the ±10% circuit band. Returns the price.
   */
  async pricedAt(symbol: string, factor = 1) {
    return this.setPrice(symbol, tick5((await this.prevClose(symbol)) * factor));
  }

  /** End of day: every waiting order expires. */
  expireOrders() {
    return this.hook('orders/expire');
  }

  /** Expiry day: settle every option position with this expiry, now. */
  settleOptions(expiry: string) {
    return this.hook('options/settle', { expiry }) as Promise<{ settled: number }>;
  }

  /** Back to normal: session follows the clock, prices move. */
  async reset() {
    await this.hook('market/session', { state: 'auto' });
    await this.resume();
  }
}
