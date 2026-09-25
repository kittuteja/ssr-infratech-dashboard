# SSR INFRATECH — Vercel development dashboard

This is the **development version only** of SSR INFRATECH Material Management. Its official logo, orange/cream branding, DEV labels, email usernames, staff accounts and inventory features are preserved. It is prepared for manual deployment to a separate Vercel project. No existing live or development deployment is changed by this source package.

**Start here: [VERCEL-DEPLOY.md](VERCEL-DEPLOY.md).**

## Included

- Categories, brands, suppliers, specifications and project-wise material tracking.
- Receive/issue stock, batch/reference, movement date and recorded timestamp.
- Stock history, low-stock alerts, audit attribution and CSV export.
- SSR username/email and password login; administrator-managed staff accounts.
- Temporary passwords, required first-login password change, reset/deactivation and session revocation.
- Persistent Turso **libSQL** database with atomic stock updates and retry protection.
- Owner setup with a private deployment key, and separately enabled owner recovery.

## Run locally

Use Node.js 24:

```sh
npm ci
cp .env.example .env.local
npm run setup:key
```

Paste the generated key into `OWNER_SETUP_KEY` in `.env.local`. Keep it private. Then:

```sh
npm test
npm run dev
```

Open http://127.0.0.1:4176/owner-setup. Enter the same key and choose an administrator username/email and password. The local server always uses `.sites-runtime/vercel-development.sqlite`, even if remote database credentials exist in your environment. It binds only to loopback and does not grant automatic owner access.

## Implementation

`api/handler.mjs` is the Vercel Node.js function. All URLs are rewritten to it. `scripts/build.mjs` bundles the application and assets; the static output directory deliberately contains no inventory pages. Authentication and page permissions remain enforced by the server.

`server/libsql.mjs` adapts the existing prepared statements to libSQL. Transactional batches preserve SQLite `changes()` guards so concurrent stock issues cannot overwrite stock or create incorrect history. A hosted deployment requires a remote database; a local SQLite file is rejected on Vercel.

`npm run vercel-build` validates database configuration, applies migrations and builds the app. `drizzle/*.sql` migrations are applied transactionally and recorded with hashes. Repeated deployments skip applied migrations; changed migration files fail rather than silently altering history. Generate new migrations with `npm run db:generate`; never edit previously applied ones.

Passwords use salted scrypt. Sessions use HttpOnly, Secure (HTTPS), SameSite=Strict cookies with hashed tokens, CSRF protection and a 12-hour lifetime. Login and owner-key attempts are rate limited in the database. Client-supplied former-host identity headers grant no privileges. There is no public signup or automatic reset email.

Tests cover core inventory and authentication, libSQL migration rollback, persistence across server restarts, concurrent issues, staff restrictions, owner setup/recovery, and separate databases. The Vercel adapter tests run locally against libSQL; a deployed cloud smoke check is still required after your deployment.

## Data and environments

Create a fresh development database for this project. Existing hosted accounts, materials and sessions are **not copied automatically**. Never connect this development app to the live database. Use a second development/preview database if you enable branch previews; preview and stable DEV environment values must not point at production.

Projects currently available: Nakshatra, HM Grandeur and Sri Sai Bhageeratha Residency. Admin and Staff users share the development inventory. Purchase orders and accounting are outside this version.
