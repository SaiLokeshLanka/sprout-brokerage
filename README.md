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
| Testing    | Playwright (planned in `e2e/`)                            |

## Repository layout

```
brokerage-app/
├── frontend/            React app (http://localhost:5173)
├── backend/             NestJS API (http://localhost:3000/api)
│   ├── src/             modules: health, instruments, prisma
│   └── prisma/          schema, migrations, seed data (instrument master)
├── e2e/                 Playwright tests (Phase 7)
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
| POST   | `/api/orders`                | yes    | `{ symbol, side, orderType, qty, limitPricePaise?, product? }`; optional `Idempotency-Key`. 201 with status `EXECUTED`, `OPEN` or `REJECTED` |
| GET    | `/api/orders`                | yes    | Your orders, newest first. Query: `status`, `limit` |
| GET    | `/api/orders/:id`            | yes    | One of your orders (404 for anyone else's)   |
| DELETE | `/api/orders/:id`            | yes    | Cancel an `OPEN` order (409 otherwise)       |
| GET    | `/api/portfolio/holdings`    | yes    | Shares owned, average price, realised P&L    |
| WS     | `/socket.io` namespace `/account` | token | Private event `order` whenever one of your orders changes |
| GET    | `/api/market/status`         | public | Is the market open? (`MARKET_MODE=always` or `nse`) |
| GET    | `/api/market/quotes`         | public | Latest quote for every instrument (paise)    |
| GET    | `/api/market/quotes/:symbol` | public | One quote incl. ±10% circuit limits          |
| GET    | `/api/market/candles/:symbol`| public | Chart points. Query: `range=1D\|1W\|1M\|1Y\|5Y` |
| WS     | `/socket.io`                 | public | Events: `status`, `snapshot` (on connect), `ticks` (every second) |

### Test hooks (only when `ENABLE_TEST_HOOKS=true`, never in production)

| Method | Path                         | Body                                         |
| ------ | ---------------------------- | -------------------------------------------- |
| POST   | `/api/test/market/pause`     | — freezes prices                             |
| POST   | `/api/test/market/resume`    | —                                            |
| POST   | `/api/test/market/price`     | `{ symbol, price }` (rupees) — set an exact price |
| POST   | `/api/test/market/session`   | `{ state: "open" \| "closed" \| "auto" }`     |
| POST   | `/api/test/orders/expire`    | — expires every OPEN order (end of day)      |

In the browser (dev mode) the same hooks are available as `window.__market.pause()`, `.setPrice('TCS', 4100)`, etc.

## How orders move money

| Event                   | Ledger journal   | Money / shares                                        |
| ----------------------- | ---------------- | ----------------------------------------------------- |
| Market buy executes     | `TRADE_BUY`      | cash → exchange; shares added to the holding          |
| Limit buy waits         | `ORDER_BLOCK`    | cash → blocked                                        |
| Limit buy executes      | `TRADE_BUY`      | blocked → exchange, unused part back to cash          |
| Open buy cancelled/expired | `ORDER_RELEASE` | blocked → cash                                      |
| Limit sell waits        | —                | shares reserved on the holding                        |
| Sell executes           | `TRADE_SELL`     | exchange → cash; realised P&L = proceeds − average cost |

Open orders are matched against prices on every tick by the server, and expire when the market closes
or a new trading day starts.

## How live prices flow

```
MarketSimulator (1 tick/s) ──► Redis  ├─ hash  market:quotes   ◄── GET /api/market/quotes
                                      └─ pub/sub market:ticks  ──► WebSocket gateway ──► browsers
```

## Testing

- `npm run test:api -w backend` — API smoke tests, needs the API running:
  - `api-smoke.mjs` (52 checks): auth, lockout, token rotation, KYC rules, idempotency, concurrent withdrawals, ledger integrity
  - `market-smoke.mjs` (34 checks): quotes, tick size, circuit limits, candles, WebSocket stream, test hooks
  - `orders-smoke.mjs` (57 checks): buy/sell/limit/cancel/expiry, rejections, idempotency, races, privacy,
    account WebSocket, and database invariants (ledger, blocked funds, reserved shares, holdings)
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
- [ ] Phase 4 — portfolio & P&L
- [ ] Phase 6 — pro features (indicators, options chain, advanced orders)
- [ ] Phase 7 — Playwright framework
- [ ] Phase 8 — CI/CD and deployment
