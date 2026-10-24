# Sprout — paper-trading brokerage

A Groww-style stock trading app for the Indian market (NSE/BSE), built to practise full-stack development
and Playwright test automation. **Paper trading only — all money is virtual and prices are simulated.**

## Tech stack

| Layer      | Choice                                                    |
| ---------- | --------------------------------------------------------- |
| Frontend   | React 18 + TypeScript + Vite, TradingView Lightweight Charts |
| Backend    | NestJS 10 (TypeScript)                                    |
| Database   | PostgreSQL 16 via Prisma ORM                              |
| Cache / pub-sub | Redis 7                                              |
| Testing    | Playwright UI tests (`e2e/`), Vitest unit tests, API smoke scripts |

## Repository layout

```
brokerage-app/
├── frontend/            React app (http://localhost:5173)
├── backend/             NestJS API (http://localhost:3000/api)
│   ├── src/             modules: auth, users, wallet, market, orders (incl. GTT), options, charges, portfolio
│   └── prisma/          schema, migrations, seed data (instrument master)
├── e2e/                 Playwright UI tests
├── docker-compose.yml   Postgres + Redis for local development
└── package.json         npm workspaces + root scripts
```

## Prerequisites

- Node.js 20+ (`node -v`)
- Docker Desktop (`docker --version`) — runs Postgres and Redis
- Git

## Getting started

```bash
npm install            # installs frontend + backend (npm workspaces)
cp backend/.env.example backend/.env   # first time only (Windows: copy backend\.env.example backend\.env)
npm run db:setup       # start Postgres/Redis, apply migrations, seed instruments
npm run dev            # API on :3000 and web app on :5173
```

## Scripts (run from the repo root)

| Script                 | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Run API and web app together                          |
| `npm run dev:web`      | Web app only                                          |
| `npm run dev:api`      | API only (auto-restarts on change)                    |
| `npm run build`        | Production build of both                              |
| `npm run typecheck`    | TypeScript check of both                              |
| `npm run db:up` / `db:down` | Start / stop Postgres and Redis containers       |
| `npm run db:migrate`   | Apply database migrations                             |
| `npm run db:seed`      | Load the instrument master (safe to re-run)           |
| `npm run db:setup`     | `db:up` + `db:migrate` + `db:seed`                    |
| `npm run format`       | Format code with Prettier                             |
| `npm run test:unit`    | Unit tests (chart indicator maths, Vitest)            |
| `npm run test:e2e`     | Playwright UI tests (needs the app running)           |

Create a new migration after editing `backend/prisma/schema.prisma`:
`npm run db:migrate:new -w backend -- --name describe_change`

## Demo account

Created by `npm run db:seed`: **demo@sprout.dev / Demo@1234** (KYC verified, ₹1,00,000 virtual balance).
Its PAN `ABCDE1234F` is taken, which is handy for testing the "PAN already linked" rule.

## API (so far)

Every route requires `Authorization: Bearer <accessToken>` unless marked public.

| Method | Path                         | Auth   | Description                                  |
| ------ | ---------------------------- | ------ | -------------------------------------------- |
| GET    | `/api/health`                | public | Liveness + database status                   |
| GET    | `/api/instruments`           | public | List instruments. Query: `type=EQUITY\|INDEX`, `q=search` |
| GET    | `/api/instruments/:symbol`   | public | One instrument, e.g. `/api/instruments/RELIANCE` |
| POST   | `/api/auth/register`         | public | `{ fullName, email, password }` → access token + refresh cookie |
| POST   | `/api/auth/login`            | public | `{ email, password }`; locks for 15 min after 5 failures (423) |
| POST   | `/api/auth/refresh`          | cookie | Rotates the refresh cookie, returns a new access token |
| POST   | `/api/auth/logout`           | cookie | Revokes the session                          |
| GET    | `/api/me`                    | yes    | Your profile                                 |
| PATCH  | `/api/me`                    | yes    | `{ fullName?, phone? }`                      |
| POST   | `/api/me/kyc`                | yes    | `{ pan, dateOfBirth }` — 18+, PAN unique     |
| GET    | `/api/wallet`                | yes    | Balance (paise)                              |
| GET    | `/api/wallet/transactions`   | yes    | Ledger history. Query: `limit`, `cursor`     |
| POST   | `/api/wallet/deposit`        | yes    | `{ amountPaise }`; optional `Idempotency-Key` header |
| POST   | `/api/wallet/withdraw`       | yes    | `{ amountPaise }`; needs verified KYC        |
| POST   | `/api/orders`                | yes    | `{ symbol, side, orderType: MARKET\|LIMIT\|SL\|SL_M, qty, limitPricePaise?, triggerPricePaise?, product? }`; optional `Idempotency-Key`. 201 with status `EXECUTED`, `OPEN`, `TRIGGER_PENDING` or `REJECTED` |
| POST   | `/api/orders/preview`        | yes    | Same body; places nothing. Value, every charge, total to pay/receive |
| GET    | `/api/orders`                | yes    | Your orders, newest first. Query: `status`, `limit` |
| GET    | `/api/orders/:id`            | yes    | One of your orders (404 for anyone else's)   |
| DELETE | `/api/orders/:id`            | yes    | Cancel an `OPEN` or `TRIGGER_PENDING` order (409 otherwise) |
| POST   | `/api/gtt`                   | yes    | `{ symbol, side, kind: SINGLE\|OCO, qty, triggerPricePaise, limitPricePaise, stopTriggerPricePaise?, stopLimitPricePaise? }` |
| GET    | `/api/gtt`                   | yes    | Your GTTs, newest first. Query: `status`     |
| DELETE | `/api/gtt/:id`               | yes    | Cancel an `ACTIVE` GTT (409 otherwise)       |
| GET    | `/api/options/underlyings`   | public | NIFTY / BANKNIFTY: lot size, strike step, upcoming expiries |
| GET    | `/api/options/chain`         | public | Query: `underlying`, `expiry?`. 31 strikes of calls and puts with premium, IV, Greeks, OI |
| GET    | `/api/options/quote/:symbol` | public | One contract, e.g. `NIFTY26102724500CE`      |
| GET    | `/api/portfolio/options`     | yes    | Your option positions with live premium and Greeks |
| GET    | `/api/portfolio/holdings`    | yes    | Shares at live prices, day basis, realised P&L (today / all time) |
| GET    | `/api/portfolio/summary`     | yes    | Totals (invested, current, P&L, day P&L, net worth) + sector allocation |
| GET    | `/api/portfolio/trades`      | yes    | Trade book. Query: `from`, `to`, `symbol`, `limit` |
| GET    | `/api/reports/pnl`           | yes    | Realised P&L per stock. Query: `from`, `to` (default: this financial year) |
| GET    | `/api/reports/statement`     | yes    | Cash statement with opening/closing balance  |
| GET    | `/api/reports/contract-note` | yes    | One day's trades. Query: `date=YYYY-MM-DD`   |
| GET    | `/api/reports/{pnl,trades,statement}.csv` | yes | CSV downloads (same query params)  |
| WS     | `/socket.io` namespace `/account` | token | Private event `order` whenever one of your orders changes |
| GET    | `/api/market/status`         | public | Is the market open? (`MARKET_MODE=always` or `nse`) |
| GET    | `/api/market/quotes`         | public | Latest quote for every instrument (paise)    |
| GET    | `/api/market/quotes/:symbol` | public | One quote incl. ±10% circuit limits          |
| GET    | `/api/market/candles/:symbol`| public | Chart points. Query: `range=1D\|1W\|1M\|1Y\|5Y`, `format=line\|ohlc` (OHLC candles with volume) |
| WS     | `/socket.io`                 | public | Events: `status`, `snapshot` (on connect), `ticks` (every second) |

### Test hooks (only when `ENABLE_TEST_HOOKS=true`, never in production)

| Method | Path                         | Body                                         |
| ------ | ---------------------------- | -------------------------------------------- |
| POST   | `/api/test/market/pause`     | — freezes prices                             |
| POST   | `/api/test/market/resume`    | —                                            |
| POST   | `/api/test/market/price`     | `{ symbol, price }` (rupees) — set an exact price |
| POST   | `/api/test/market/session`   | `{ state: "open" \| "closed" \| "auto" }`     |
| POST   | `/api/test/orders/expire`    | — expires every waiting order (end of day); GTTs are not affected |
| POST   | `/api/test/options/settle`   | `{ expiry }` — settle every position in that expiry now, at the current index price |

In the browser (dev mode) the same hooks are available as `window.__market.pause()`, `.setPrice('TCS', 4100)`, etc.

## How orders move money

| Event                   | Ledger journal   | Money / shares                                        |
| ----------------------- | ---------------- | ----------------------------------------------------- |
| Market buy executes     | `TRADE_BUY`      | cash → exchange; shares added to the holding          |
| Limit / stop buy waits  | `ORDER_BLOCK`    | cash → blocked (price × qty **+ charges** at that price) |
| Waiting buy executes    | `TRADE_BUY`      | blocked → exchange, unused part back to cash          |
| Waiting buy cancelled/expired | `ORDER_RELEASE` | blocked → cash                                   |
| Limit / stop sell waits | —                | shares reserved on the holding                        |
| Sell executes           | `TRADE_SELL`     | exchange → cash; realised P&L = proceeds − average cost |
| Any trade executes      | `CHARGES`        | cash → charges account (brokerage, STT, fees, GST)    |
| Option expiry           | `TRADE_SELL`     | exchange → cash at intrinsic value (no charges)       |

Waiting orders are checked against prices on every tick by the server: limit orders fill when their price is
reached, stop-loss orders (`TRIGGER_PENDING`) activate when their trigger is reached (SL-M executes at market,
SL becomes a limit order), and GTTs place a limit order when triggered. Day orders expire when the market
closes or a new trading day starts; GTTs last a year.

## How charges are calculated

Rates live in one file, `backend/src/charges/charges.ts` (illustrative, close to 2025 published rates).
Each part is rounded to the paisa.

| Charge        | Delivery          | Intraday                 | Options (on premium) |
| ------------- | ----------------- | ------------------------ | -------------------- |
| Brokerage     | ₹0                | 0.03%, max ₹20 per order | ₹20 per order        |
| STT           | 0.1% buy and sell | 0.025% on sells          | 0.1% on sells        |
| Exchange fee  | 0.00297%          | 0.00297%                 | 0.03503%             |
| SEBI fee      | ₹10 per crore     | ₹10 per crore            | ₹10 per crore        |
| Stamp duty    | 0.015% on buys    | 0.003% on buys           | 0.003% on buys       |
| GST           | 18% of (brokerage + exchange fee + SEBI fee) | same | same           |

## How options work here

- Index options on NIFTY (lot 75, weekly Tuesday expiry) and BANKNIFTY (lot 35, monthly last-Tuesday expiry).
  Lot sizes are illustrative.
- Symbols: `NIFTY26102724500CE` = NIFTY, expiry 2026-10-27, strike ₹24,500, call. Contracts are generated, not stored.
- Premiums come from the Black-Scholes formula using the simulated index price, a 6.5% interest rate and a
  volatility smile around 13% (NIFTY) / 15% (BANKNIFTY). Open interest and volume are simulated.
- Buying only; selling is allowed to close a position (no naked selling, so no margin rules).
- At 3:30 PM IST on expiry day positions are cash-settled at intrinsic value: max(0, index − strike) for calls,
  max(0, strike − index) for puts.

## How P&L is calculated

- **Average cost:** a holding's average price = total cost ÷ shares. Selling removes shares at that average.
- **Realised P&L** (on each sell) = sale value − average cost of the shares sold.
- **Unrealised P&L** = shares × live price − total cost.
- **Day's P&L** = shares × live price − day basis, where the day basis counts shares held from before
  today at yesterday's close and shares bought today at their buy price.
- **Net worth** = free cash + blocked cash + shares at market value
  (always = money deposited − withdrawn + unrealised + realised P&L).
- Report date ranges are IST calendar days; the default is the Indian financial year (1 April – 31 March).

## How live prices flow

```
MarketSimulator (1 tick/s) ──► Redis  ├─ hash  market:quotes   ◄── GET /api/market/quotes
                                      └─ pub/sub market:ticks  ──► WebSocket gateway ──► browsers
```

## Testing

- `npm run test:api -w backend` — API smoke tests, needs the API running:
  - `api-smoke.mjs` (52 checks): auth, lockout, token rotation, KYC rules, idempotency, concurrent withdrawals, ledger integrity
  - `market-smoke.mjs` (34 checks): quotes, tick size, circuit limits, candles, WebSocket stream, test hooks
  - `orders-smoke.mjs` (59 checks): buy/sell/limit/cancel/expiry, rejections, idempotency, races, privacy,
    account WebSocket, and database invariants (ledger, blocked funds, reserved shares, holdings)
  - `portfolio-smoke.mjs` (54 checks): valuation, day P&L, realised P&L, allocation, trade book, P&L report,
    statement, contract note (with charge breakdown), CSV exports, date validation
  - `pro-smoke.mjs` (77 checks): charges against the published rates, SL / SL-M / stop buy, GTT single and OCO,
    options chain (put-call parity, Greeks), option trading rules and expiry settlement
- `npm run test:unit` — Vitest unit tests for the indicator maths (SMA, EMA, RSI against Wilder's published example, MACD, Bollinger)
- `npm run test:e2e` — Playwright UI tests in Microsoft Edge (see `e2e/README.md`)

## Conventions

- **Money is stored as integer paise** (₹1 = 100 paise) — never floating point.
- **Double-entry ledger**: every money movement is a journal whose entries sum to zero; entries are never edited.
- Prices are rounded to the instrument's tick size (₹0.05 for NSE equities).
- Every interactive UI element has a `data-testid` for Playwright.

## Roadmap

- [x] Frontend UI (simulated market in the browser)
- [x] **Phase 0** — monorepo, Docker infra, backend skeleton, instrument master
- [x] **Phase 1** — auth (JWT + rotating refresh cookie), profile & KYC, double-entry wallet ledger
- [x] **Phase 2** — server-side market simulator, Redis pub/sub, WebSocket prices, candles, market sessions
- [x] **Phase 3** — server-side order management: orders, holdings, matching engine, blocked funds, expiry
- [x] **Phase 4** — portfolio valuation & day P&L, trade book, P&L report, statement, contract notes, CSV exports
- [x] **Phase 6** — charges, stop-loss (SL, SL-M) and GTT orders, candlestick chart with indicators, index options chain
- [ ] Phase 7 — Playwright framework
- [ ] Phase 8 — CI/CD and deployment
