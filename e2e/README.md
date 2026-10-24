# e2e — Playwright tests

End-to-end tests that drive the real app in Microsoft Edge.

## Run

Start the app first (Docker Desktop → `npm run db:up` → `npm run dev`), then from the repo root:

| Command                         | What it does                                          |
| ------------------------------- | ----------------------------------------------------- |
| `npm run test:e2e`              | Run all tests (headless — no visible window)          |
| `npm run test:headed -w e2e`    | Run with the browser visible                          |
| `npm run test:ui -w e2e`        | Interactive UI mode: pick tests, watch each step      |
| `npm run report -w e2e`         | Open the HTML report of the last run                  |
| `npm run codegen -w e2e`        | Record clicks in a browser and generate test code     |
| `npx playwright test login -w e2e` | Run only files whose name contains "login"         |

## Layout

```
e2e/
├── playwright.config.ts   shared settings: base URL, browser, screenshots/video/trace on failure
└── tests/
    ├── login.spec.ts      redirect, wrong password, form validation, demo login/logout
    ├── market.spec.ts     prices set via API test hooks appear in the UI; closed market blocks trading
    ├── trade.spec.ts      buy, limit order fill, cancel, sell with profit, rejection (fresh user per test)
    ├── reports.spec.ts    P&L report + CSV download, contract note, statement, allocation, date errors
    ├── advanced-orders.spec.ts  stop-loss trigger, error shown before placing, OCO GTT fires, cancel GTT
    ├── chart.spec.ts      candlestick chart: SMA matches the candles, indicator strips on/off, ranges
    ├── options.spec.ts    options chain, buy/sell a call, expiry settlement
    └── helpers.ts         shared helpers: new user + login, set price, API orders, money formatting, charges
```

## Notes

- Tests use `data-testid` locators — they don't break when text or styling changes.
- The market is shared, so tests that pause it or set prices run one at a time (`workers: 1`)
  and always resume it in `afterEach`.
- Test hooks (`/api/test/market/*`) need `ENABLE_TEST_HOOKS=true` in `backend/.env`.
- Edge is launched with its downloads panel disabled: otherwise it opens a hidden extra page after each
  download, and Playwright reports "Target page, context or browser has been closed" at the end of the test.
- The full framework (page objects, fixtures, API tests, CI) is roadmap Phase 7.
