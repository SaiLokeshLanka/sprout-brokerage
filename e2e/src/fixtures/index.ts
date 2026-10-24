import { test as base, expect } from '@playwright/test';
import { ApiClient } from '../api/ApiClient';
import { MarketControl } from '../api/MarketControl';
import type { PublicUser } from '../api/types';
import { newUserData, UserData } from '../data/users';
import { ContractNotePage } from '../pages/ContractNotePage';
import { ExplorePage } from '../pages/ExplorePage';
import { FundsPage } from '../pages/FundsPage';
import { InvestmentsPage } from '../pages/InvestmentsPage';
import { LoginPage } from '../pages/LoginPage';
import { OptionsPage } from '../pages/OptionsPage';
import { OrdersPage } from '../pages/OrdersPage';
import { ReportsPage } from '../pages/ReportsPage';
import { StockPage } from '../pages/StockPage';

/** A user created for one test, with an API client that acts as them. */
export interface Trader extends UserData {
  user: PublicUser;
  api: ApiClient;
}

interface Fixtures {
  /** API client with no login: public endpoints and registering users. */
  api: ApiClient;
  /** Test hooks for the simulated market. Automatically reset after every test that uses it. */
  market: MarketControl;
  /** A brand-new user (₹1,00,000 welcome money), NOT logged in to the browser. For API tests. */
  newTrader: Trader;
  /**
   * A brand-new user, already logged in to the test's browser page.
   * The login happens through the API (no typing in the form), which takes a fraction of a second.
   */
  trader: Trader;

  loginPage: LoginPage;
  explorePage: ExplorePage;
  stockPage: StockPage;
  ordersPage: OrdersPage;
  fundsPage: FundsPage;
  investmentsPage: InvestmentsPage;
  reportsPage: ReportsPage;
  contractNotePage: ContractNotePage;
  optionsPage: OptionsPage;
}

/**
 * Fixtures are the building blocks a test asks for by name:
 *
 *   test('…', async ({ trader, market, stockPage }) => { … })
 *
 * Playwright creates only what the test asks for, in the right order, and runs each
 * fixture's clean-up code (after `use`) when the test ends — even if it failed.
 */
export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    await use(new ApiClient(request));
  },

  market: async ({ request }, use) => {
    const market = new MarketControl(request);
    await use(market);
    // Clean-up: the market is shared, never leave it frozen or closed for the next test.
    await market.reset();
  },

  newTrader: async ({ api }, use) => {
    const data = newUserData();
    const session = await api.register(data);
    await use({ ...data, user: session.user, api: api.as(session.accessToken) });
  },

  trader: async ({ newTrader, page }, use) => {
    // Log in through the API *inside the browser context*: page.request shares the context's
    // cookie jar, so the httpOnly refresh cookie the server sets lands in the browser.
    // When the app loads, it uses that cookie to restore the session — exactly like a returning user.
    // (Through the web server's /api proxy, so the cookie belongs to the app's address.)
    const res = await page.request.post('/api/auth/login', { data: { email: newTrader.email, password: newTrader.password } });
    expect(res.ok(), `API login failed: ${await res.text()}`).toBeTruthy();
    await use(newTrader);
  },

  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  explorePage: async ({ page }, use) => use(new ExplorePage(page)),
  stockPage: async ({ page }, use) => use(new StockPage(page)),
  ordersPage: async ({ page }, use) => use(new OrdersPage(page)),
  fundsPage: async ({ page }, use) => use(new FundsPage(page)),
  investmentsPage: async ({ page }, use) => use(new InvestmentsPage(page)),
  reportsPage: async ({ page }, use) => use(new ReportsPage(page)),
  contractNotePage: async ({ page }, use) => use(new ContractNotePage(page)),
  optionsPage: async ({ page }, use) => use(new OptionsPage(page)),
});

export { expect };
