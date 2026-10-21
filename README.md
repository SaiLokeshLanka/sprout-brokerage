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

## API (so far)

| Method | Path                         | Description                                  |
| ------ | ---------------------------- | -------------------------------------------- |
| GET    | `/api/health`                | Liveness + database status                   |
| GET    | `/api/instruments`           | List instruments. Query: `type=EQUITY\|INDEX`, `q=search` |
| GET    | `/api/instruments/:symbol`   | One instrument, e.g. `/api/instruments/RELIANCE` |

## Conventions

- **Money is stored as integer paise** (₹1 = 100 paise) — never floating point.
- Prices are rounded to the instrument's tick size (₹0.05 for NSE equities).
- Every interactive UI element has a `data-testid` for Playwright.

## Roadmap

- [x] Frontend UI (simulated market in the browser)
- [x] **Phase 0** — monorepo, Docker infra, backend skeleton, instrument master
- [ ] Phase 1 — auth, KYC, wallet ledger
- [ ] Phase 2 — market data service + WebSockets
- [ ] Phase 3 — order management system & execution engine
- [ ] Phase 4 — portfolio & P&L
- [ ] Phase 6 — pro features (indicators, options chain, advanced orders)
- [ ] Phase 7 — Playwright framework
- [ ] Phase 8 — CI/CD and deployment
