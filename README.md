# SSR INFRATECH — Material Management

## Vercel development dashboard

The complete Vercel-ready **DEV application** is in [`vercel-dev/`](vercel-dev/), including email/username login, administrator-managed staff accounts, material tracking, Admin-only People & Payments and persistent Turso libSQL storage.

Import this repository into a **new development Vercel project** and select **Root Directory: `vercel-dev`**. Follow the [deployment guide](vercel-dev/VERCEL-DEPLOY.md) to configure a separate development database and private owner setup key. The build command is `npm run vercel-build`; Node.js 24 and the remaining settings are configured in that folder. All 34 automated tests pass, including 15 People & Payments tests.

This source update is prepared for the separate Vercel DEV project; it does not publish to either existing Sites dashboard. Existing hosted accounts and inventory are not copied automatically. Keep the live database separate from Vercel development and preview databases.

### People & Payments

Admins can maintain people/entities with multiple roles and projects, record incoming/outgoing INR payments, create separate receivables/payables, apply partial payments, record linked refunds, review correction history and export filtered CSV reports. Staff cannot access financial records. No bank connection or money transfer is involved, and no sample financial records are seeded. See the [module definitions, permissions, migration and backup guide](vercel-dev/README.md#people--payments-setup-and-use). Existing inventory, accounts and sessions are preserved by additive migration `0002_people_payments.sql`.

## Environments

| Environment | Dashboard | Source archive |
| --- | --- | --- |
| Development — testing | [Open development](https://ssr-infratech-materials-dev.stardhoomer.chatgpt.site) | [Development source](ssr-infratech-dev-source.tar.gz) |
| Production — real inventory | [Open production](https://ssr-infratech-materials.stardhoomer.chatgpt.site) | [Production source](ssr-infratech-fullstack-source.tar.gz) |

These existing dashboards use separate Sites projects and databases. Production retains its existing access controls; the hosted development version supports SSR staff credentials. Development stock entries and deployments do not update production. The development dashboard is labeled DEVELOPMENT WORKSPACE.

## Full-stack source

The archives are older snapshots of the Sites deployments. They contain the frontend, Worker API, local SQLite server, database schema, generated migrations, tests and package lockfile. Credentials, dependencies and local inventory data are excluded. Root HTML, CSS and JavaScript files are the earlier browser-storage prototype. Use `vercel-dev/` for the current Vercel development application.

### Run development locally

Use Node.js 24 or later:

```sh
tar -xzf ssr-infratech-dev-source.tar.gz
cd ssr-infratech-dev
npm ci
npm test
npm run build
npm run dev
```

Open http://127.0.0.1:4174. Local preview uses its own SQLite file and a fixed preview identity. See the archive's README for architecture and migration details.

## Release workflow

Make and test changes in development first. Publish to the development Site using its own `.openai/hosting.json`. Promote reviewed source changes to the production checkout only when a production release is requested; preserve the production manifest. Do not copy the development database, test records, or local runtime files into production. GitHub source uploads do not automatically deploy either dashboard.

Each archive contains its environment's hosting manifest. The logical binding name `DB` is the same in both; Sites provisions it separately for each project.

| Source snapshot | Commit |
| --- | --- |
| Development | `08c0ddc63c3cc8e6a3cb23a86e306d3a48a8c677` |
| Production | `6183cd0b9dcc0881bd40b623067ae3ad845c7251` |

## Features and validation

Official SSR INFRATECH branding, material categories, brands, suppliers, stock receipts/issues, batches, dates and user-attributed history. Both releases passed five backend tests covering authentication/origin checks, duplicate-request protection, concurrent stock issues, version-controlled edits and invalid data rejection.
