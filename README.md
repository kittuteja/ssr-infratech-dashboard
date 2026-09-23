# SSR INFRATECH dashboard

First working Material Management prototype for SSR INFRATECH, Kurnool.

## Run

Serve this folder with any static HTTP server, for example `python3 -m http.server 4173`.

No package installation or build is required. The page uses plain HTML, CSS and JavaScript. Google Fonts are optional; system sans-serif is the fallback.

## Features

- Inventory and valuation by project
- Material, category and stock-status filters
- Add materials with units, reorder levels and costs
- Receive or issue materials; prevent issuing more than available
- Movement history, low-stock alerts and filtered CSV export
- Responsive layout and keyboard-accessible native dialogs

## Data boundary

All quantities, prices and movement records are illustrative. Project names come from the company's public website. Records live only in page memory and reset on refresh. This is not a production inventory system and has no shared database, user roles or server-side audit log yet.

## Repository

https://github.com/kittuteja/ssr-infratech-dashboard

## Brand assets

The unmodified logo (`ssr-logo.jpg`) and favicon (`favicon.jpg`) come from SSR INFRATECH's official website, https://ssrinfratech.in/. Original logo: https://ssrinfratech.in/wp-content/uploads/2026/01/cropped-SSR-INFRATECH_Business-Card-2.jpg. Original favicon: https://ssrinfratech.in/wp-content/uploads/2026/01/cropped-SSR-INFRATECH_Business-Card-2-32x32.jpg.

Palette: orange #F7941D, cream #FFEFDC, charcoal #333333 and white. Typography uses the site's Poppins, Outfit and Playfair families via Google Fonts. The dashboard uses SSR's published tagline: “Built with trust. Designed with intention. Delivered with integrity.”
