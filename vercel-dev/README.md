# SSR INFRATECH — Vercel development dashboard

This is the **development version only** of SSR INFRATECH Material Management and People & Payments. Its official logo, orange/cream branding, DEV labels, email usernames, staff accounts and inventory features are preserved. It is prepared for manual deployment to a separate Vercel project. No existing live or development deployment is changed by this source package.

**Start here: [VERCEL-DEPLOY.md](VERCEL-DEPLOY.md).**

## Included

- Categories, brands, suppliers, specifications and project-wise material tracking.
- Receive/issue stock, batch/reference, movement date and recorded timestamp.
- Stock history, low-stock alerts, audit attribution and CSV export.
- SSR username/email and password login; administrator-managed staff accounts.
- Temporary passwords, required first-login password change, reset/deactivation and session revocation.
- Persistent Turso **libSQL** database with atomic stock updates and retry protection.
- Owner setup with a private deployment key, and separately enabled owner recovery.
- Admin-only People & Payments: multi-role profiles, a cash ledger, receivables/payables, partial applications, linked refunds, correction history and CSV reports.

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

Projects currently available: Nakshatra, HM Grandeur and Sri Sai Bhageeratha Residency. Admin and Staff users share the development inventory. People & Payments uses these same project names. Purchase orders, payroll calculation, tax calculations and double-entry accounting are outside this version.


## People & Payments: setup and use

No new environment variables, payment provider, bank connection or credentials are needed. Sign in with an existing **Admin** account, then open **People & Payments** (`/people-payments`). A Staff account does not see the navigation link and cannot access financial pages, APIs, history or exports.

1. Add a person/entity with one or more business roles and associated projects. A business profile is not a login account.
2. Record an amount owed **to SSR** (receivable) or **by SSR** (payable), including its obligation date and due date. This does not record cash.
3. Record money in/out. Use **Completed** only when money actually moved; **Pending** is excluded from cash totals.
4. Use **Apply** / **Apply payment** to connect a completed payment to an amount due. Enter a partial amount if appropriate. Multiple payments may settle one due, and one payment may settle several dues.
5. Open a profile for its all-time payment/obligation history, salary and advance summaries. Use each record’s **Details** to review applications and refunds, or **History** for versions and reasons.

There are no sample records, default financial profiles or seeding scripts. Automated tests use disposable local databases. Hosted records must be entered deliberately by an authorized Admin.

### Permissions

| Capability | Admin | Staff / signed out |
| --- | --- | --- |
| View profiles, financial summaries, ledger, dues and history | Yes, all projects | No |
| Export financial CSVs | Yes | No |
| Create/edit/deactivate business profiles | Yes | No |
| Record/correct/void payments and refunds | Yes, subject to integrity checks | No |
| Create/correct/cancel obligations; apply/reverse payments | Yes, subject to integrity checks | No |
| Delete financial records or edit past audit entries | No | No |

The existing `admin` login role is intentionally the only financial permission. There is no per-project financial access or read-only accountant role in this release. Customer/Employee/Worker/etc. are profile labels, not authorization roles. Promoting a Staff login to Admin grants full financial access as well as account management; the account-management screen explains this. Existing active-session, forced-password-change, CSRF, role-change and session-revocation rules still apply. Turso credentials are read exclusively on the server.

### Data definitions and counting rules

All currency is **INR**. API and database amounts are positive integer **paise** (₹1 = 100 paise); the UI accepts at most two decimal places and converts without parsing fractional rupees as a floating-point amount. A single record is limited to 1,000,000,000,000 paise (₹10,000,000,000.00). Aggregate totals must remain safe integers. CSVs label INR amounts, raw paise, calendar dates and UTC audit timestamps explicitly.

- **Cash totals:** Total Received = completed `in` payments; Total Paid = completed `out` payments, filtered by payment date. Pending/void payments and obligations do not count. These are gross actual movements, not revenue, expense, profit or bank balances. This module does not send money or process payments.
- **Categories:** In: Customer payment, Booking amount, Installment, Advance received, Other. Out: Salary, Worker wage, Contractor payment, Vendor payment, Advance paid, Reimbursement, Other. Categories label payments and obligations; they do not themselves create an amount due or calculate salary.
- **Amounts due:** independent obligations with an original amount, obligation date, due date and direction. `in` means owed to SSR, `out` means owed by SSR. Open obligations remain open in storage when fully settled; the calculated display status becomes Paid. Pending balance = obligation amount minus active payment applications. Cancelled obligations have zero pending balance.
- **Partial payments:** applications must match person, project and direction, but may cross categories (e.g. Advance paid applied to Salary). Only completed non-refund payments can be applied. Applications cannot exceed either the payment’s free balance or the due’s pending balance. There is no automatic matching, netting across directions, cross-project transfer, or implicit application.
- **Advances:** count once as completed cash in/out. They reduce a due only when explicitly applied. Unapplied advances remain available for later application or refund, not automatically a new payable/receivable. If an advance is repayable, record that obligation explicitly; it is never invented from a payment category.
- **Refunds:** separate linked entries against a completed original payment, with the same person/project, opposite direction and category Other. Refunds appear in the appropriate gross cash total and also in separate refund subtotals. Pending refunds reserve the original’s available balance but do not count as cash. Completed refunds reduce the original’s refundable/applicable balance. Refunds cannot be applied to dues or refunded again. To refund allocated money, reverse the relevant application first; this reopens the due. If the underlying obligation is no longer owed, cancel/replace that obligation explicitly after reversing all its applications. Refunding money alone does not cancel a debt.
- **Salary summary:** “Salary payments, net of refunds” is completed Salary-category cash less linked completed refunds. “Salary dues settled” is the amount applied to Salary obligations, including advances or other eligible payment categories. These overlap and must not be added together. “Pending salary” is the unpaid part of explicit Salary obligations, not salary automatically accrued from an employee profile. Worker wage is a separate category.
- **Date basis:** payment/obligation/due dates are calendar dates. Completed payments and obligation dates cannot be in the future; due dates and pending payment dates may be future. Applications/reversals use the server’s current India Standard Time date and cannot be backdated. Audit timestamps are UTC and displayed in IST.
- **Report range:** cash is filtered by payment date. Obligations are filtered by **due date** within the same range, with their balance calculated through the end date; obligations issued after the end date are excluded. The default end date is today. “Include all upcoming dues” extends the end date to 9999-12-31. This is a due-date cohort report: obligations due before the selected start date are excluded even if unpaid. Clear the start date to include older outstanding amounts. Payment-status filters affect only payments/cash; due-status filters affect only obligations. Profile lists ignore date/category/direction/payment-status filters. Project, person, profile role/status and search apply where relevant. Profile details always show all-time history and future dues.
- **Historical reports are restated:** reports use the latest corrected versions and current profile roles/names. Applications are included only on/after their application date and before their reversal date. A later correction, cancellation or void restates a past report; it is not a frozen accounting period or an immutable “what was known then” report. The audit log retains before/after versions for investigation. Export a dated report if you need a period snapshot.

### Corrections, duplicates and integrity

Every creation and correction records a user and timestamp. Corrections require an explanation of at least eight characters and the current version, preventing lost edits from stale tabs. Payment states are Pending → Completed/Void, or Completed → Void; completed payments cannot return to Pending. Void payments and cancelled obligations are final. There are no delete APIs. Database triggers also reject financial deletes and changes to audit/idempotency history; allocations can only be reversed once.

Before a payment has allocation/refund history, its financial details can be corrected with an audited reason. Once linked history exists, person, project, direction, category, amount and payment date are fixed. Reverse active applications, void any active child refunds, void the payment, then enter a replacement. Notes, reference and mode remain correctable. The original refund link cannot change. Obligations with application history similarly lock person, project, direction, category, amount and dates: reverse applications, cancel and replace to change those fields. All old records and links remain visible.

Profile codes are unique after normalization, including inactive profiles. Similar normalized names, email addresses or phone numbers require reviewing the existing profiles and recording why a separate profile is needed. Deactivation preserves all history, reserves its code, and blocks new payments/dues against the inactive profile; existing records can still be corrected and existing applications reversed. Reactivate the profile when recording further activity. Profile history is retained even after its role/project associations change.

Non-void payments reserve a normalized reference per payment mode and direction. A matching unreferenced payment (person, project, direction, date, amount and mode) requires an explicit duplicate explanation. All writes require a UUID `Idempotency-Key`; the actor, method, route and payload are bound to that key. An exact retry returns the original result. Reusing a key for different data or a different user is rejected. Preserve the same key when retrying an uncertain request; refresh before submitting new data. The browser keeps its key for identical retries while the form is open.

All validation, state changes, audit inserts and idempotency records for a mutation commit in one libSQL write transaction. Allocation/refund capacity is checked inside that transaction. Transaction failure rolls everything back. Audit/request history has no automatic retention purge. Administrative SQL access is more powerful than app permissions; limit who can hold the database token.

### Migration and deployment

`drizzle/0002_people_payments.sql` adds six `pp_*` tables, indexes and history-protection triggers. Migrations `0000` and `0001` are unchanged. Existing inventory, accounts, sessions and their migration hashes are preserved. No sample financial data is inserted. `db/schema.ts` and the new Drizzle snapshot describe the tables; custom triggers are in the SQL migration.

For an existing Vercel **DEV** database, back it up, deploy this source from `vercel-dev`, and let `npm run vercel-build` apply the new migration. Existing administrators keep their credentials; no setup key is needed for an already-initialized database. For a new preview database, follow [VERCEL-DEPLOY.md](VERCEL-DEPLOY.md) and initialize its owner separately. Do not reset the database or re-run owner setup for an existing installation. Never put the live database URL/token into this project, including its Preview environment.

Keep the Vercel framework set to Other and Output Directory to `dist/static`. The build copies only the public favicon there to satisfy Vercel’s non-empty-output requirement; financial HTML, JS and CSS stay behind the authenticated function.

### Backup and restore guidance

Before migration, record the DEV database name, current code commit and migration ledger, and create a protected backup/recovery point. Establish a backup schedule suited to your records and verify restores; filtered CSV reports are not database backups because they omit accounts, sessions, allocation/audit history and migration state.

[Turso point-in-time recovery](https://docs.turso.tech/features/point-in-time-recovery) restores into a **new** database at a chosen timestamp. Check your account’s actual retention window. A typical restore drill is:

```sh
# Substitute your DEV database and a timestamp within its retention window.
turso db create ssr-dev-restore-check --from-db YOUR_DEV_DATABASE --timestamp YYYY-MM-DDTHH:MM:SSZ
```

Keep the original database intact. Issue a database-scoped token for the restored copy, connect a separate DEV verification deployment to it, and verify migration hashes, user access, inventory balances, financial counts/totals and audit/application history before any deliberate connection switch. A database restore can resurrect old sessions; invalidate sessions in the restored copy before making it accessible to users. Do not point a live app at a test restore.

For offline backups, follow the current [Turso export instructions](https://docs.turso.tech/cli/db/export):

```sh
turso db export YOUR_DEV_DATABASE --output-file ssr-dev-backup.db
```

Turso warns that an exported snapshot may lag recent changes and may need SDK synchronization; do not assume it includes the latest transactions. Verify freshness against known record timestamps/counts or use a verified recovery point. Backups contain private profiles, finances and authentication data: encrypt them, restrict access, store them outside Git, and apply a documented retention policy. Restore drills should include `PRAGMA integrity_check`, foreign-key checks and application-level balance checks on the restored copy.

### Verification

Run `npm test` with Node.js 24. Tests use local disposable libSQL databases and cover exact paise calculations, cash-vs-due separation, partial/split payments, advances/salary summaries, refund reservations and reversals, permissions and CSRF, duplicate requests/records, simultaneous allocations, correction versions, immutable history, CSV escaping, report dates, and migration preservation. Existing inventory/login tests remain part of the same suite.

A local browser check covers profile creation, an obligation and partial payment, application/reversal, refund defaults, person summaries and a 390px mobile layout. The fixture is disposable and is not shipped. Hosted smoke checks still need to be performed after manual DEV deployment: sign in as Admin, open the empty/existing module, confirm Staff receives 403, and verify existing inventory/accounts are intact. Use a separate disposable preview database for any synthetic financial test records; never seed the live dashboard.
