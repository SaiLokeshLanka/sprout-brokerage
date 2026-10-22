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

## Testing

- `npm run test:api -w backend` — API smoke test (52 checks: auth, lockout, token rotation, KYC rules,
  idempotency, concurrent withdrawals, ledger integrity). Needs the API running.

## Conventions

- **Money is stored as integer paise** (₹1 = 100 paise) — never floating point.
- **Double-entry ledger**: every money movement is a journal whose entries sum to zero; entries are never edited.
- Prices are rounded to the instrument's tick size (₹0.05 for NSE equities).
- Every interactive UI element has a `data-testid` for Playwright.

## Roadmap

- [x] Frontend UI (simulated market in the browser)
- [x] **Phase 0** — monorepo, Docker infra, backend skeleton, instrument master
- [x] **Phase 1** — auth (JWT + rotating refresh cookie), profile & KYC, double-entry wallet ledger
- [ ] Phase 2 — market data service + WebSockets
- [ ] Phase 3 — order management system & execution engine
- [ ] Phase 4 — portfolio & P&L
- [ ] Phase 6 — pro features (indicators, options chain, advanced orders)
- [ ] Phase 7 — Playwright framework
- [ ] Phase 8 — CI/CD and deployment
