# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a **crypto portfolio tracker** built with Next.js 15 (App Router + Turbopack), Prisma ORM with SQLite, and NextAuth for authentication. See `README.md` for standard dev commands.

### Dev environment quickstart

After dependency installation (`npm install` + `npm run db:generate` + `npx prisma migrate deploy`), start the dev server with `npm run dev` on port 3000.

### Non-obvious caveats
- **Auth on localhost**: Despite `useSecureCookies: true` in `src/lib/auth.ts`, credentials login works on `http://localhost:3000` without HTTPS.
- **Email verification required for credentials login**: Newly registered users have `emailVerified = null`. The sign-in callback rejects unverified users. For local dev, manually set `emailVerified` in SQLite after registration: `npx prisma db execute --schema prisma/schema.prisma --stdin <<< "UPDATE User SET emailVerified = datetime('now') WHERE email = 'YOUR_EMAIL';"`
- **`.env` setup**: Copy `.env.example` to `.env` and set `NEXTAUTH_SECRET` (generate with `openssl rand -hex 32`). `DATABASE_URL` and `NEXTAUTH_URL` defaults in `.env.example` work for local dev. Google OAuth and SMTP are optional.
- **Lint**: `npm run lint` — returns exit code 0; existing warnings are pre-existing (unused vars, React hooks deps).
- **No automated test suite**: The project has no test runner or test files configured.
