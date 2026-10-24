# e2e — Sprout's Playwright test framework

Automated tests for the whole app: the API, the UI in a real browser (Microsoft Edge), screenshots,
and accessibility. 95 tests, about 2 minutes.

## Run

Start the app first (Docker Desktop → `npm run db:up` → `npm run dev`), then from the repo root:

| Command                                   | What it runs                                              |
| ----------------------------------------- | --------------------------------------------------------- |
| `npm run test:e2e`                        | Everything (all projects)                                 |
| `npm run test:smoke -w e2e`               | Only tests tagged `@smoke`: a 10-second health check      |
| `npm run test:quick -w e2e`               | Everything except tests tagged `@slow`                    |
| `npm run test:api -w e2e`                 | API tests only (no browser, ~10 s)                        |
| `npm run test:ui -w e2e`                  | Browser tests only                                        |
| `npm run test:visual -w e2e`              | Screenshot comparison                                     |
| `npm run test:visual:update -w e2e`       | Save new baseline screenshots after an intended UI change |
| `npm run test:a11y -w e2e`                | Accessibility scans                                       |
| `npm run test:headed -w e2e`              | Browser tests with the window visible                     |
| `npm run test:debug -w e2e`               | Step through a test line by line in the Playwright Inspector |
| `npm run test:interactive -w e2e`         | UI mode: pick tests, watch each step, time-travel         |
| `npm run report -w e2e`                   | Open the HTML report of the last run                      |
| `npm run codegen -w e2e`                  | Record clicks in a browser and generate test code         |
| `npx playwright test trading -w e2e`      | Only files whose name contains "trading"                  |

A failed test keeps a screenshot, a video and a trace in `test-results/`. Open a trace with
`npx playwright show-trace test-results/<test>/trace.zip` to replay every step with the page as it was.

## Layout

```
e2e/
├── playwright.config.ts     projects, timeouts, reporters, browser, evidence on failure
├── src/                     the framework (no tests here)
│   ├── config.ts            app and API addresses (override with WEB_URL / API_URL)
│   ├── fixtures/index.ts    test, expect and every fixture (api, market, trader, page objects)
│   ├── api/
│   │   ├── ApiClient.ts     typed calls to the API: register, buy, deposit, createGtt…
│   │   ├── MarketControl.ts test hooks: freeze prices, set a price, close the market, settle options
│   │   └── types.ts         shapes of API responses
│   ├── pages/               page objects: one class per page
│   │   ├── BasePage.ts
│   │   ├── LoginPage.ts  ExplorePage.ts  StockPage.ts  OrdersPage.ts  FundsPage.ts
│   │   ├── InvestmentsPage.ts  ReportsPage.ts  ContractNotePage.ts  OptionsPage.ts
│   │   └── components/      parts used on several pages: Header, OrderPanel (+ GTT form), AdvancedChart
│   ├── data/users.ts        test data: unique users, demo user, PAN numbers
│   └── utils/               money formatting and charges, IST dates, accessibility helper
└── tests/
    ├── setup/               runs first: is the app up? are test hooks on?
    ├── api/                 *.api.spec.ts    — backend only
    ├── ui/                  *.spec.ts        — end-to-end in the browser
    ├── visual/              *.visual.spec.ts — screenshots (+ __screenshots__/ baselines per OS)
    └── a11y/                *.a11y.spec.ts   — axe-core WCAG 2.1 AA scans
```

## Projects

`playwright.config.ts` splits the tests into projects. Each has its own folder and settings:

| Project  | Browser | Depends on | Purpose |
| -------- | ------- | ---------- | ------- |
| `setup`  | —       | —          | Fails fast with a clear message if the API, database, Redis, web app or test hooks are missing |
| `api`    | none    | setup      | Status codes, response bodies, business rules |
| `ui`     | Edge    | setup      | User journeys through the real app |
| `visual` | Edge 1280×800 | setup | Pixel comparison with saved screenshots |
| `a11y`   | Edge    | setup      | Accessibility rules |

Tests run one at a time (`workers: 1`): they share one simulated market and set its prices.

## Writing a test

```ts
import { expect, test } from '../../src/fixtures';   // not from '@playwright/test'

test('a stop-loss sell triggers when the price falls', async ({ trader, market, stockPage }) => {
  // Arrange — fast, through the API
  const price = await market.pricedAt('ITC');        // freeze ITC at yesterday's close
  await trader.api.buy('ITC', 5);

  // Act — through the UI, with page objects
  await stockPage.goto('ITC');
  await stockPage.orderPanel.placeOrder({ side: 'SELL', type: 'sl_m', qty: 5, triggerPaise: price - 500 });

  // Assert — web-first assertions retry until true (up to 5 s)
  await expect(stockPage.orderPanel.result).toContainText('Stop-loss order placed');
});
```

### Fixtures

Ask for what the test needs by name; Playwright builds it before the test and cleans up after.

| Fixture | What you get | Clean-up |
| ------- | ------------ | -------- |
| `api` | `ApiClient` without login (public endpoints, registering) | — |
| `market` | `MarketControl` for the test hooks | Market reset: session follows the clock, prices move |
| `newTrader` | A new user with ₹1,00,000 and `newTrader.api` acting as them — not logged in to the browser | — |
| `trader` | Same, **and the browser page is logged in** as that user | — |
| `loginPage`, `stockPage`, `ordersPage`, … | Page objects for the test's page | — |

### Rules

- **Locators**: use `data-testid` (`page.getByTestId`) or roles — never CSS classes or text that might change.
  Keep locators inside page objects, not in tests.
- **No fixed waits**: `expect(locator).toHaveText(…)` and `expect.poll(…)` retry; `waitForTimeout` is only for
  deliberately waiting out a timer (see the `@slow` session test).
- **Each test makes its own user** (`trader` / `newTrader`), so tests never depend on each other or on order.
  The shared demo user is only used for read-only checks.
- **Money is paise** in tests and the API; format for the screen with `inr` / `inrPaise`.
- **Arrange with the API, act and assert in the UI.** Only click through what the test is about.
- **Expected values are worked out independently** (e.g. `deliveryCharges()` re-implements the published
  rates) so a bug in the app can't hide behind a test that copies it.
- **Tags**: add `{ tag: '@smoke' }` to a few critical tests and `{ tag: '@slow' }` to long ones.

## Logging in: why every test gets a fresh session

The usual Playwright approach is to log in once, save the browser's cookies (`storageState`) to a file,
and load that file in every test. That does not work for Sprout, and that is a security feature, not a bug:

- the refresh cookie **changes every time it is used** (rotation), and
- if an old cookie is used again more than 30 seconds later, the server assumes it was **stolen** and logs
  the user out everywhere.

So a saved file works for the first test only. Instead, the `trader` fixture creates a new user and logs in
**through the API inside the test's browser context** (`page.request.post('/api/auth/login')`): the server
sets the cookie straight into the browser, no typing needed, in about 0.1 seconds. `tests/ui/auth.spec.ts`
shows `storageState` working once, and proves the theft protection (`@slow`, it waits 31 seconds).

## Visual tests

- Baselines live in `tests/visual/__screenshots__/<os>/`. Fonts render differently on Windows, macOS
  and Linux, so each operating system has its own set (Linux ones will be created in CI, Phase 8).
- Anything that changes by itself (prices, generated ids, emails) is hidden with `mask`.
- A failed comparison writes `expected`, `actual` and `diff` images to `test-results/` and shows them in the
  HTML report. If the change was intended, run `npm run test:visual:update -w e2e` and commit the new images.

## Accessibility tests

`src/utils/a11y.ts` runs [axe-core](https://github.com/dequelabs/axe-core) with the WCAG 2.1 A + AA rules and
returns a readable list of problems (rule, what is wrong, how to fix, which elements). The first run found
text too light to read on **every page** (grey, green, red, purple and amber text below the 4.5:1 contrast
ratio, in both themes); it was fixed in five colour tokens in `frontend/src/styles.css`. Automated scans find roughly
a third of accessibility problems; keyboard and screen-reader checks by a person are still needed.

## Test hooks used

`/api/test/market/{pause,resume,price,session}`, `/api/test/orders/expire`, `/api/test/options/settle`.
They exist only when the API runs with `ENABLE_TEST_HOOKS=true` and never in production.
