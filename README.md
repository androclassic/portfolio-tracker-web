# Portfolio Tracker (Crypto)

A modern, self-hostable crypto portfolio tracker built with **Next.js + Prisma (SQLite)**.

- **Live app**: https://crypto-portofolio.com/

## What it does (capabilities)

- **Multi-portfolio support**: track multiple wallets/accounts/strategies under one login.
- **Transactions ledger**: log **Buy / Sell / Deposit / Withdrawal** events with timestamps, quantities, fees, and notes.
- **Portfolio overview & dashboards**:
  - holdings table
  - allocation and performance visuals
  - portfolio summaries across time
- **Price data**:
  - current prices for tracked assets
  - historical price series for charts
- **Import / export**:
  - export transactions to CSV
  - import transactions from CSV (including a TradingView-friendly format)
- **Romania tax reporting**:
  - compute taxable events
  - export detailed CSV reports
  - configurable lot strategies (**FIFO/LIFO/HIFO/LOFO**) for assets and cash
- **Authentication**:
  - email (magic link) + optional password setup
  - Google OAuth
  - credentials login (email verification enforced)

## Examples (high level)

Typical workflows:

- **Start tracking**:
  - Create an account → create a portfolio → add a few buys/sells/deposits/withdrawals → review holdings & allocation.
- **Bootstrap from history**:
  - Import a CSV (or TradingView export) → validate assets → see your portfolio overview update.
- **Tax time (Romania)**:
  - Select year + portfolio + lot strategies → generate report → export CSV for reconciliation.

## Tech stack (high level)

- **Next.js (App Router)** UI + API routes
- **Prisma + SQLite** persistence (simple single-file DB, easy to self-host)
- **NextAuth** for auth providers and sessions
- **SWR** for responsive, cached data fetching
- **Plotly** chart components

## Run locally (development)

```bash
npm install
npm run db:generate
npm run dev
```

Open `http://localhost:3000`.

## Docker (recommended for self-hosting)

```bash
cp env.production.example .env.production
# edit .env.production with real secrets/keys
docker compose build
docker compose up -d
```

Notes:
- Docker runs the app on **port 3033** (mapped to `http://localhost:3033`).
- The SQLite DB is stored at `/data/dev.db` in the container and persisted via the `./prisma` volume mount.

## Configuration

See `env.production.example` for the expected environment variables (notably `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `DATABASE_URL`, and OAuth/email provider settings).
