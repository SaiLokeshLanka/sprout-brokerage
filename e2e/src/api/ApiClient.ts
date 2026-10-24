import { APIRequestContext, expect } from '@playwright/test';
import { API_URL } from '../config';
import type { UserData } from '../data/users';
import type { Gtt, Holding, OptionChain, Order, OrderPreview, PlaceOrder, Quote, Session, Wallet } from './types';

/** What the API sends back when a request fails (400, 401, 404, 409...). */
export interface ApiError {
  statusCode?: number;
  /** One message, or a list of validation messages. */
  message?: string | string[];
}

export interface ApiResponse<T> {
  status: number;
  /** The data on success, or the error fields on failure. */
  body: T & ApiError;
  headers: Record<string, string>;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * Talks to the Sprout API directly, without a browser. Used for:
 * - API tests (check status codes and response bodies), and
 * - fast test setup in UI tests (create a user, buy shares, add money...) so the UI test
 *   only clicks through the part it is actually testing.
 *
 * `call()` returns whatever the server answered, for negative tests (400, 401, 409...).
 * The named helpers (buy, deposit, ...) expect success and fail the test with the
 * server's message if it didn't happen.
 */
export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    readonly token?: string,
  ) {}

  /** The same client, acting as a logged-in user. */
  as(token: string) {
    return new ApiClient(this.request, token);
  }

  async call<T = any>(method: Method, path: string, options: { data?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResponse<T>> {
    const res = await this.request.fetch(`${API_URL}${path}`, {
      method,
      data: options.data,
      headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...options.headers },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // CSV or plain text
    }
    return { status: res.status(), body: body as T & ApiError, headers: res.headers() };
  }

  /** Like `call`, but fails the test unless the status is the expected one. */
  private async expectStatus<T>(status: number, method: Method, path: string, data?: unknown, headers?: Record<string, string>) {
    const res = await this.call<T>(method, path, { data, headers });
    expect(res.status, `${method} ${path} → ${JSON.stringify(res.body)}`).toBe(status);
    return res.body;
  }

  // ── Auth ──────────────────────────────────────────────
  register(user: UserData) {
    return this.expectStatus<Session>(201, 'POST', '/auth/register', user);
  }

  login(email: string, password: string) {
    return this.expectStatus<Session>(200, 'POST', '/auth/login', { email, password });
  }

  // ── Wallet ────────────────────────────────────────────
  wallet() {
    return this.expectStatus<Wallet>(200, 'GET', '/wallet');
  }

  deposit(amountPaise: number) {
    return this.expectStatus<{ balancePaise: number }>(201, 'POST', '/wallet/deposit', { amountPaise });
  }

  verifyKyc(pan: string, dateOfBirth = '1990-05-15') {
    return this.expectStatus(200, 'POST', '/me/kyc', { pan, dateOfBirth });
  }

  // ── Orders ────────────────────────────────────────────
  placeOrder(order: PlaceOrder, idempotencyKey?: string) {
    return this.call<Order>('POST', '/orders', { data: order, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} });
  }

  /** A market order that must execute. Returns the executed order (with its charges). */
  async marketOrder(symbol: string, side: 'BUY' | 'SELL', qty: number) {
    const order = await this.expectStatus<Order>(201, 'POST', '/orders', { symbol, side, orderType: 'MARKET', qty });
    expect(order.status, `${side} ${qty} ${symbol}: ${order.statusReason}`).toBe('EXECUTED');
    return order;
  }

  buy(symbol: string, qty: number) {
    return this.marketOrder(symbol, 'BUY', qty);
  }

  sell(symbol: string, qty: number) {
    return this.marketOrder(symbol, 'SELL', qty);
  }

  preview(order: PlaceOrder) {
    return this.call<OrderPreview>('POST', '/orders/preview', { data: order });
  }

  order(id: string) {
    return this.call<Order>('GET', `/orders/${id}`);
  }

  orders() {
    return this.expectStatus<Order[]>(200, 'GET', '/orders');
  }

  cancelOrder(id: string) {
    return this.call<Order>('DELETE', `/orders/${id}`);
  }

  /** Re-reads an order until it reaches `status` (the server's matcher works on price ticks). */
  async waitForOrderStatus(id: string, status: Order['status']) {
    let last: Order | undefined;
    await expect
      .poll(async () => (last = (await this.order(id)).body).status, { message: `order ${id} never became ${status}`, timeout: 5_000 })
      .toBe(status);
    return last!;
  }

  // ── GTT ───────────────────────────────────────────────
  createGtt(gtt: Record<string, unknown>) {
    return this.call<Gtt>('POST', '/gtt', { data: gtt });
  }

  gtts() {
    return this.expectStatus<Gtt[]>(200, 'GET', '/gtt');
  }

  cancelGtt(id: string) {
    return this.call<Gtt>('DELETE', `/gtt/${id}`);
  }

  // ── Portfolio & market data ───────────────────────────
  holdings() {
    return this.expectStatus<{ holdings: Holding[]; realizedPnlPaise: number }>(200, 'GET', '/portfolio/holdings');
  }

  optionPositions() {
    return this.expectStatus<Holding[]>(200, 'GET', '/portfolio/options');
  }

  quote(symbol: string) {
    return this.expectStatus<Quote>(200, 'GET', `/market/quotes/${symbol}`);
  }

  optionChain(underlying = 'NIFTY', expiry?: string) {
    return this.expectStatus<OptionChain>(200, 'GET', `/options/chain?underlying=${underlying}${expiry ? `&expiry=${expiry}` : ''}`);
  }
}
