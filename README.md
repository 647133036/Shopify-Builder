# Shopify Builder

Tools for standing up a Shopify store fast: a design kit that themes a running
OS 2.0 store, and an importer that feeds it catalog data.

```
shopify-facelift/    Design system + Liquid kit. Makes a theme look finished.
shopify-importer/    CSV and API product importer. Makes a theme have products.
```

Use them in that order. The facelift defines how the store looks; the importer
fills it with inventory.

## shopify-facelift

A drop-in design system plus Liquid kit for a clean, high-end store in neutral
whites, greys and blacks. It applies to a running OS 2.0 theme without
replacing it.

- `brand.css` — the design system
- `preview/` — static mockup of home, collection, product and cart, no build
  step
- `shopify/` — everything you upload to a live theme: two assets, three
  snippets, five sections, theme settings schema
- `tests/smoke.js` — 48 DOM tests over the preview

Start here: `shopify-facelift/README.md`.

## shopify-importer

Turn supplier product data into live Shopify products. Reads a CSV or JSON file
or pulls from another supplier's REST or GraphQL API, normalises it to
Shopify's model, compresses the images, and writes either a Shopify-native
`products.csv` or pushes it through the Admin API.

Ships as a CLI and as a hosted multi-user web app.

Version 0.1.0.

Start here: `shopify-importer/README.md`.

## Requirements

Both projects run on Node.js 22.5 or newer. `shopify-importer` additionally
needs `sharp` installed globally, which the hosted app and CLI share:

```bash
npm install -g sharp
export NODE_PATH=$(npm root -g)
```

There is no build step, no bundler, and no ORM in either project.

## Quick start

```bash
# Preview the facelift design system
cd shopify-facelift
python3 -m http.server 8080

# Normalise a supplier CSV into Shopify's format
cd ../shopify-importer
npm install --omit=dev
npm run normalize -- --in examples/products.csv --out out

# Run the importer's web app
NODE_PATH=$(npm root -g) node bin/app.js --port 3000 --data ./data
```

## Testing

```bash
# Design system: 48 tests
node shopify-facelift/tests/smoke.js

# Importer core: 99 tests
cd shopify-importer
NODE_PATH=$(npm root -g) node tests/smoke.js
```

The importer also has an HTTP suite covering the web app end to end:

```bash
node bin/app.js --port 8082 --data ./data-test
BASE=http://127.0.0.1:8082 node tests/e2e.js
```

It needs a fresh data directory because it walks the first-admin setup path.

## Notes

- `data/` is gitignored. It holds the importer's SQLite database, its
  session-signing key, and every connected store's Shopify admin token.
- Customer accounts are not part of either project. Shopify Accounts V2 renders
  `/account`, `/login` and `/register` natively; they are customised in Shopify
  Settings, not in theme files.
- Shopify's own product CSV importer is a fine default for a one-off catalog.
  The importer here earns its place when the source data is messy: arbitrary
  column names, oversized images, variants spread across consecutive rows, or a
  supplier API instead of a file.

## License

MIT — see [LICENSE](LICENSE).
