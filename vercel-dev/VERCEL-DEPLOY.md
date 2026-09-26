# Deploy the SSR development dashboard to Vercel

This package is **DEV only**. Keep the current live site and its database in place. Use a new Vercel project such as `ssr-infratech-dev`.

## 1. Select the development source

The complete application is in `vercel-dev/` in this repository, including `api`, `public`, `server`, `scripts`, `drizzle`, `db`, `package.json`, `package-lock.json`, and `vercel.json`.

When importing `kittuteja/ssr-infratech-dashboard` into Vercel, select **Root Directory: `vercel-dev`**. Do not import the old prototype root or the old source archives.

## 2. Create a development database

Create a new **libSQL database** in [Turso](https://turso.tech/) or connect Turso through the [Vercel Marketplace](https://vercel.com/marketplace/tursocloud). Select the libSQL engine compatible with `@libsql/client`, not a different database engine. Choose a region near your Vercel function region.

Name it clearly, for example `ssr-materials-dev`. Obtain its database URL and database-scoped read/write auth token. Do not use the live database or a Turso organization API token.

Vercel functions do not store this app's database on their local filesystem. The database must be remote and persistent. [Turso's Vercel integration documentation](https://docs.turso.tech/integrations/vercel) describes the URL/token connection used here.

## 3. Set Vercel environment variables

In the **new DEV project's** Settings → Environment Variables, add:

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | The new development database's `libsql://…` URL (HTTPS also supported) |
| `TURSO_AUTH_TOKEN` | That database's read/write token; mark it sensitive |
| `OWNER_SETUP_KEY` | A new private 64-character hexadecimal key; generate it with `npm run setup:key` and mark it sensitive |
| `OWNER_RECOVERY_KEY` | Leave unset for ordinary use |

Generate the setup key locally using Node.js 24:

```sh
npm run setup:key
```

Keep the output in your password manager. It is a setup secret, not the administrator's login password. Never put keys or database tokens in GitHub, browser URLs, or public configuration.

Apply these values to Vercel's **Production** environment for this new DEV project. Vercel uses “Production” to mean the project's stable URL; this app still displays **DEVELOPMENT WORKSPACE** and remains separate from SSR's live site.

For branch previews, configure a **different development/preview database and new setup key** under Vercel's **Preview** environment. Without the required environment values, the build intentionally fails. Each empty database needs its own administrator setup.

## 4. Deploy

Import the repository and the correct root directory. Use:

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Node.js | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run vercel-build` |
| Output Directory | `dist/static` |

`vercel.json` already defines the build, output, function and routing settings. Keep it in the selected root directory.

Click **Deploy**. The build applies the schema automatically. It needs the database URL, token and setup key available during the build. It neither seeds sample data nor copies the existing hosted database.

For CLI deployment from this source folder instead of GitHub import:

```sh
npx vercel login
npx vercel link
```

Choose or create the **new DEV project**, set the environment variables in its Vercel dashboard, then run:

```sh
npx vercel --prod
```

Here `--prod` publishes the stable URL of the DEV project; do not link this folder to SSR's live project.

## 5. Create your DEV administrator

1. Open `https://YOUR-DEV-URL/owner-setup`.
2. Enter the private setup key from step 3.
3. Enter your name and administrator username/email, such as `krishnateja.alaganuru@gmail.com`.
4. Choose and confirm a password of at least 15 characters.
5. After setup, remove `OWNER_SETUP_KEY` from Vercel and redeploy. Existing accounts and data remain intact; the initial setup key cannot reset an existing administrator.
6. Open **Staff accounts** to create development staff logins. Temporary passwords are displayed once, expire in 24 hours, and must be changed after the first sign-in. No email is sent automatically.

Old-host credentials are not transferred automatically. A fresh database starts with no users, materials or financial records. Existing Vercel DEV administrators keep their credentials when upgrading.

## 6. Verify the deployed DEV app

- Confirm the DEVELOPMENT label and official SSR logo.
- Create a disposable DEV staff account, sign in, and change its temporary password.
- Create a DEV material, receive/issue stock, and refresh or sign in from another browser to verify shared persistence.
- Check that staff cannot open Staff accounts and signed-out visitors cannot read inventory.
- Reset or deactivate the DEV staff account and verify its old session stops working.
- Redeploy and confirm the DEV material remains in the same remote database.

Local automated checks passed before packaging; these steps confirm your actual Vercel account, routing, secrets and remote database configuration.

## Owner recovery

Generate a **new different key**, set `OWNER_RECOVERY_KEY` in the DEV project's environment, and redeploy. Open `/owner-setup`, enter the recovery key, and choose a new owner password. The old owner sessions are revoked. Remove the recovery variable and redeploy immediately afterwards. Staff password resets are available to administrators inside the dashboard.

## Troubleshooting

- **Database initialization failed:** the build now prints a safe error code, deployment environment and stage. `DB_URL_MISSING` / `DB_TOKEN_MISSING` means the corresponding variable is absent for that deployment. A PR/non-main branch normally uses **Preview**, so Production-only variables are not available. In the DEV project’s Settings → Environment Variables, configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for Preview (or its branch override), using a separate preview database, then redeploy. Vercel’s **Development** scope is for local `vercel dev`, not hosted previews.
- **`OWNER_SETUP_REQUIRED`:** the selected database has no owner; set a new private `OWNER_SETUP_KEY` for the same environment using `npm run setup:key`. Existing database owners need no new setup key.
- **`DB_HTTP_401` / `DB_HTTP_403` / `SQLITE_READONLY`:** verify the token is valid, belongs to the selected database and permits migration writes. A `MIGRATION_CHANGED` error requires restoring the original migration from Git, not changing the database ledger. SQL errors identify the migration file and statement number without printing SQL or credentials.
- **npm deprecation/audit/install-script warnings:** these are separate from a database-initialization failure. Do not run `npm audit fix --force` to try to fix missing deployment variables; it can change dependency versions without solving the configuration issue.
- **Administrator setup is disabled:** add a valid `OWNER_SETUP_KEY` and redeploy if this database has no administrator. If it already has an administrator, sign in or use the separate recovery procedure.
- **Wrong page, missing function or 404:** verify the selected root contains this package's `vercel.json`, `api/handler.mjs` and `package.json`. Do not deploy the old prototype or upload only `dist`.
- **Local preview:** use Node.js 24, configure `.env.local` from `.env.example`, and run `npm run dev`. The local database is intentionally separate from the Vercel database.

Reference: [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js).


## People & Payments upgrade

This module is Admin-only and uses the same SSR login and development database. Before upgrading, follow the backup guidance in [README.md](README.md). The build applies additive migration `0002_people_payments.sql`; do not edit old migrations, replace the database or recreate the existing owner. No additional secrets or banking/payment integrations are required.

After deployment, an Admin can open `/people-payments` from the inventory navigation. Verify financial pages/APIs/exports are denied to Staff and signed-out visitors, and that existing inventory and sessions are preserved. No financial records are seeded. Run synthetic financial tests only in a disposable local or isolated preview database. Keep Preview credentials separate from the stable DEV project and both separate from SSR’s live dashboard.

Environment scope reference: [Vercel environment variables](https://vercel.com/docs/environment-variables). Variable changes apply to new deployments; [redeploy after updating them](https://vercel.com/docs/environment-variables/managing-environment-variables).
