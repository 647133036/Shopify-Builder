# shopify-importer

Turn product data from a supplier into live Shopify products.

Most Shopify stores get their catalog from somewhere: a supplier CSV, a partner
API, an XLSX exported as CSV, a Google Sheet, an ERP. Every one of those sources
has its own column names, its own image URLs, its own idea of what a "variant"
is, and none of them matches Shopify's model. This tool sits in between and
does the translation, in either direction you need it:

- `csv` mode — read a CSV or JSON file, normalise it, compress and rename the
  images, write a Shopify-native `products.csv` that you can either hand to
  Shopify's own CSV importer or push straight through the Admin API.
- `api` mode — pull products from another supplier's REST or GraphQL endpoint,
  then do the same normalisation and upload.

It ships in two forms with the same normalisation core:

- **CLI** — for your own store, in a terminal or a cron job.
- **Hosted multi-user web app** — a small deployable server so a merchant,
  their operations team, or a client's non-technical staff can upload a file
  and import it themselves.

Version 0.1.0. MIT licensed.

---

## Prerequisites

- **Node.js 22.5 or newer.** The CLI needs 18+, but the multi-user app uses
  `node:sqlite`, which lands in Node 22.5 without a flag. Install 22 LTS and
  everything works.
- **`sharp` installed globally.** Both the CLI and the hosted app use a shared
  global `sharp`; the hosted app has no other runtime dependencies.

```bash
npm install -g sharp
```

With `sharp` global you also need it visible to Node at runtime. CommonJS
`require()` resolves from `$NODE_PATH`, so prefix commands that touch image
processing:

```bash
export NODE_PATH=$(npm root -g)
```

The CLI sets this up for you automatically. In tests, prefix with
`NODE_PATH=$(npm root -g)`.

Everything else is a Node built-in. There is no `express`, no `sqlite3`, no
ORM, no build step.

---

## Install

```bash
git clone https://github.com/647133036/Shopify-Builder.git
cd Shopify-Builder/shopify-importer
npm install --omit=dev
```

## One-command flow

```bash
# 1. Normalise the supplier CSV, compress its images, write the bundle
npm run normalize -- --in examples/products.csv --out out

# 2. Upload it to your live store
SHOP_SHOP=your-store.myshopify.com \
SHOP_ADMIN_TOKEN=shpat_xxx \
npm run import -- --mode live
```

The normalise step writes four things to `out/`:

| File | Contents |
|---|---|
| `products.csv` | Shopify-native: `handle,title,body_html,vendor,type,product_type,tag,price,sku,inventory_policy,inventory_quantity,...`, one row per variant |
| `variants.csv` | One row per variant with `product_id`, the API's product ID |
| `images.csv` | Compressed images, renamed, with their `variant_id` |
| `report.md` | A human-readable summary of every decision the tool made |

The CLI keeps one output directory per run, so repeated runs never overwrite
each other.

## CLI

```bash
node bin/import.js <command> [options]
```

| Command | Purpose |
|---|---|
| `check` | Validate a file against Shopify's required columns and print a report. Refuses to write output if required data is missing. |
| `normalize` | Map supplier columns to Shopify's, dedupe, drop malformed rows, compress images, write the output bundle. |
| `fetch` | Pull products from a supplier's API using a declarative config file. |
| `images` | Compress and rename an existing image set in place. |
| `upload` | Create the products in a live store through the Admin API. |

`check`, `normalize`, `images` and `upload` all read the output directory from
the previous step, so you can chain them without restating paths.

`upload --mode live` is the only command that talks to a store, and it is
opt-in. Default is `--mode dry-run`, which renders the full GraphQL request
and writes it to a file instead of sending it.

---

## Hosted app (multiple users)

The web app is a small deployable server so merchants, their operations teams,
or a client's non-technical staff can upload a file and import it themselves.
It has no runtime dependencies beyond `node:sqlite` and `node:http` — storage is
SQLite and passwords are scrypt.

```bash
NODE_PATH=$(npm root -g) node bin/app.js --port 3000 --data ./data
```

On first run there are no users and the login screen becomes a one-time setup
form that creates the first admin account. After that users sign in with
username/password and each stores their own Shopify credentials. Two roles:
`admin` can manage users, an `operator` can only normalise, upload and view
their own jobs.

| Route | What it does |
|---|---|
| `GET /api/health` | Liveness and version |
| `GET /api/bootstrap` | First-run flag, session, CSRF token |
| `POST /api/setup` | Create the first admin account |
| `POST /api/login` / `POST /api/logout` | Session |
| `GET/PUT/POST/DELETE /api/users…` | User management, admin only |
| `GET/PUT/DELETE /api/connection` | This user's Shopify credentials |
| `POST /api/connection/test` | Hit `/shop.json` and report store name, domain, markets |
| `POST /api/normalize` | Normalise a file and return a preview plus download URLs |
| `POST /api/import` | Enqueue a job; returns `202` and a job id |
| `GET /api/import/:id` | Job status, per-product progress, error summary |
| `GET /api/imports` | This user's job history |

Uploads are stored as a job: a `POST /api/import` returns `202` and a job id,
and the UI polls `GET /api/import/:id` for progress. That is because a live
upload with staged images can take minutes, and a single request cannot be held
open for that long.

Every user's Shopify token is stored separately, so one operator can't read or
reuse another's. Uploaded files are held in memory for the duration of the job
and written to a temp directory for the image work, which is deleted when the
job finishes — the raw CSV never lands on disk.

---

## Single-user preview

`bin/serve.js` serves the same normalisation and upload logic as a one-page UI
with no accounts and no database. It reads credentials from environment
variables and uploads directly from the browser to a store.

```bash
NODE_PATH=$(npm root -g) node bin/serve.js
```

Useful for trying a store's import in a browser before committing to the hosted
app.

---

## Data model

### Grouping into products

Each input row is a variant. Rows become products by:

1. If a row has a `handle`, start a new product with that handle.
2. Otherwise, link the row to the previous product group, because most supplier
   exports list a product's variants as consecutive rows under a single title.

Handles are slugified: lowercase, non-alphanumerics to hyphens, runs collapsed,
leading and trailing hyphens stripped.

### Deduplication

SKUs are unique across the whole run, not per product. A duplicate SKU keeps
the first occurrence and warns on the later ones.

### Malformed rows

Rows missing required data are dropped, never silently coerced:

| Error | Triggered when |
|---|---|
| `E_EMPTY_TITLE` | Title is blank after trimming |
| `E_NO_PRICE` | Price is blank or non-numeric |

### Column aliases

`FIELD_ALIASES` maps common supplier column names onto Shopify's. Add your
supplier's naming to it and the tool picks them up without any code change.

### Error policy

A row with a missing required field is reported and dropped. A row with an
invalid SKU is warned about and kept. The tool never invents a value to make a
row pass validation.

---

## Shopify permissions

`write_products` is the minimum, which is all the importer needs to create and
edit products.

`write_themes` is optional but recommended. It lets the tool stage images to
the store's own theme asset store, under `/cdn/shop/t/`, which keeps them on
the store's own domain rather than on the supplier's. Without it, images are
referenced by their original URLs.

The Admin API version used by the hosted app is `2024-10`. The CLI's default
can be overridden per call.

---

## Images

The default pipeline never up-samples. It only down-scales when an image is
larger than 2048 px on its longest side.

2048 px is a sensible default, not a Shopify requirement. The lever that
actually matters is compressed bytes, because Shopify's importer caps the size
of an uploaded image. The tool targets 716,800 bytes per image by stepping
quality down by 5 per pass to a floor of 55, rebuilding the source each pass so
quality never compounds.

---

## Limitations

- **Customer accounts are out of scope.** Shopify Accounts V2 renders
  `/account`, `/login`, `/register` natively; you customise them in Shopify
  Settings → Checkout, not in theme files. The legacy `templates/customers/`
  directory was removed in a 2024–2025 platform change.
- **API mode is declarative, not auto-detected.** The supplier's endpoint,
  auth, and field mapping are described in a JSON config file. There is no
  schema discovery.
- **Images from a supplier stay on the supplier's domain** unless you opt into
  `write_themes` staging.

---

## Tests

```bash
# Core: 99 assertions
NODE_PATH=$(npm root -g) node tests/smoke.js

# HTTP: 79 assertions against a live server
NODE_PATH=$(npm root -g) node bin/app.js --port 8082 --data ./data-test
BASE=http://127.0.0.1:8082 node tests/e2e.js
```

The e2e suite walks the first-admin setup path, so it needs a fresh data
directory and will fail against a deployment that already has users.

`data/` holds the SQLite database, the session-signing key, and every
connected store's Shopify token. It is gitignored and must never be committed.

---

## Repository layout

```
bin/
  import.js          CLI
  serve.js           single-user preview server
  app.js             multi-user hosted server
lib/
  csv.js             parse and stringify
  normalize.js       supplier rows to Shopify shape
  run.js             orchestration
  media/process.js   image pipeline
  shopify/           Admin API client, products, assets
  ingest/api.js      declarative supplier fetch
  server/            db, auth, users, imports
web/                 hosted app frontend
ui/                  single-user preview frontend
tests/               smoke and e2e suites
examples/            sample CSV, generator, API config
```

## License

MIT — see [LICENSE](../LICENSE).
