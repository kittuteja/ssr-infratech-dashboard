# SSR INFRATECH dashboard

First working Material Management prototype for SSR INFRATECH, Kurnool.

## Run

Serve this folder with any static HTTP server, for example `python3 -m http.server 4173`.

No package installation or build is required. The page uses plain HTML, CSS and JavaScript. Google Fonts are optional; system sans-serif is the fallback.

## Features

- Inventory and valuation by project
- Category groups and category, brand, text and stock-status filters
- Brand, supplier, specifications, automatic creation/update dates and editable material metadata
- Per-material movement history with movement date, recorded date, supplier/recipient, batch and reference
- Add materials with units, reorder levels and costs
- Receive or issue materials; prevent issuing more than available
- Movement history, low-stock alerts and filtered CSV export
- Responsive layout and keyboard-accessible native dialogs

## Data boundary

All quantities, prices and movement records are illustrative. Project names come from the company's public website. Records are saved in localStorage in the current browser and survive refreshes. They are not shared across devices or users, and clearing browser data removes them. CSV exports should be kept for backup. This is not a production inventory system and has no shared database, user roles or server-side audit log yet.

## Repository

https://github.com/kittuteja/ssr-infratech-dashboard

## Brand assets

The unmodified logo (`ssr-logo.jpg`) and favicon (`favicon.jpg`) come from SSR INFRATECH's official website, https://ssrinfratech.in/. Original logo: https://ssrinfratech.in/wp-content/uploads/2026/01/cropped-SSR-INFRATECH_Business-Card-2.jpg. Original favicon: https://ssrinfratech.in/wp-content/uploads/2026/01/cropped-SSR-INFRATECH_Business-Card-2-32x32.jpg.

Palette: orange #F7941D, cream #FFEFDC, charcoal #333333 and white. Typography uses the site's Poppins, Outfit and Playfair families via Google Fonts. The dashboard uses SSR's published tagline: “Built with trust. Designed with intention. Delivered with integrity.”

Materials with different brands or projects use separate stock records. Known brands, units and projects are fixed after creation to avoid rewriting a ledger’s identity. Sample records have no invented supplier or creation date; missing brands can be filled in. The stored history is local browser data, not a tamper-proof audit trail.
