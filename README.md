# SSR INFRATECH — Material Management

[Open the live dashboard](https://ssr-infratech-materials.stardhoomer.chatgpt.site)

The full-stack release is deployed privately and requires sign-in with the owner’s account. It uses a shared persistent database for material categories, brands, suppliers, stock receipts/issues, batches, dated history and user attribution. The official SSR logo and website colour palette are preserved.

## Full-stack source

The complete deployed source is in [ssr-infratech-fullstack-source.tar.gz](ssr-infratech-fullstack-source.tar.gz). It contains the frontend, Worker API, SQLite development server, database schema, generated migrations, tests and package lockfile. It excludes credentials, dependencies and local inventory data.

```sh
tar -xzf ssr-infratech-fullstack-source.tar.gz
cd ssr-infratech-fullstack
npm ci
npm test
npm run build
npm run dev
```

Use Node.js 24 or later, then open http://127.0.0.1:4174. See the archive’s README for hosting and schema migration details.

Source snapshot: `6183cd0b9dcc0881bd40b623067ae3ad845c7251`.

The root HTML, CSS and JavaScript files are the earlier browser-storage prototype. Use the live link or full-stack source archive for the current database-backed application. The live database starts empty; prototype sample data and preview test data are not imported.

## Validation

Five backend tests pass: authentication/origin checks, idempotent material creation, concurrent stock updates, version-controlled edits, and invalid data rejection. Browser verification covered creating a material and seeing its saved history after reload.
