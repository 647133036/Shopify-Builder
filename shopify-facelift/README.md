# Neutral Minimal Facelift — Shopify

A drop-in design system plus Liquid kit for a clean, high-end Shopify store in
neutral whites, greys and blacks. Built to be applied to a running OS 2.0 theme
without replacing it.

## What is in here

```
shopify-facelift/
  brand.css                     The design system. Drop into assets/brand.css
  preview/                      Live mockup of the four key templates
    index.html                    home
    collection.html               collection
    product.html                  product page
    cart.html                     cart
    preview.css                   preview-only: webfonts + SVG placeholder art
    art.js                        self-contained SVG art placeholders
    shared.js                     preview interaction layer, ~4 KB
  shopify/                      Everything you upload to the live theme
    assets/brand.css              the stylesheet
    assets/facelift.js            variant, gallery, accordion, cart helpers
    snippets/trust-badges.liquid  three-up reassurance row
    snippets/variant-selector.liquid  swatches / chips / list + variant radios
    snippets/product-card.liquid  grid card with conditional quick add
    sections/home-hero.liquid
    sections/home-collection-tiles.liquid
    sections/home-featured-products.liquid
    sections/product-media.liquid  sticky gallery with thumbnails
    sections/product-info.liquid   title, price, variants, buy box, accordions
    config/settings_schema.json  theme settings group (palette + announcement)
    config/settings_data.json    palette defaults
    docs/apply-guide.md          step-by-step install and QA
  tests/smoke.js                48 DOM tests over the preview
```

## Try the preview

Static HTML, no build step. Serve this folder — not `preview/` — because the
pages load the design system with `../brand.css`, and serving only `preview/`
returns a 404 for it and you get an unstyled page:

```bash
python3 -m http.server 8080 --directory shopify-facelift
```

Then browse to `http://localhost:8080/`. A small redirect page at the root
sends you to `preview/index.html`. All four templates are linked together:
home > collection > product > cart, with a working bag that persists across the
pages.

If you do serve `preview/` directly, copy `brand.css` into it first so the
relative path resolves.

## Verify the preview

```bash
npm install -g jsdom
NODE_PATH=$(npm root -g) node shopify-facelift/tests/smoke.js
```

Expected: `48 passed, 0 failed`. The suite covers quick add, variant selection
and price variance, quantity steppers, drawer and cart totals, free-shipping
threshold, sorting, filtering, gallery switching and accordions, plus a runtime
error check on every page.

## How the preview maps to the brief

| Request | Where it lives |
| --- | --- |
| Cohesive, high-end layout | `brand.css` tokens: 8pt spacing, 1440 container, hairline borders over shadows, tabular numerals |
| Neutral whites / greys / blacks | Eight palette tokens, all near-black ink on warm off-white, no colour accent |
| High-impact imagery placement | 4:5 gallery, sticky on desktop, `width:1600` first load, lazy thumbnails |
| Concise copy sections | Truncated descriptions above the fold, full copy in accordions |
| Clear variant selectors | Swatches, chips and list rows; per-option price deltas; sold-out states |
| Trust badges | Three-up row with monochrome stroke icons, editable copy |
| Uncluttered buy-box | One primary CTA, ghost secondary, inline qty, hairline-divided sections |
| Intuitive menus, collection hierarchy | Max two-level menus, breadcrumb on every deep page, footer repeats shop links |
| Friction-free checkout | Cart drawer on every page, quick add on single-variant cards, free-shipping progress bar |
| Light load times | 30 KB CSS / 7 KB JS total, no third-party runtime, `sizes` + `widths` on every image |
| Mobile responsiveness | Three breakpoints (1100, 860, 560), full-stack layout under 860px |

## Working assumptions

I built against these. Tell me which are wrong and I will adjust.

1. **Theme platform.** All Liquid targets OS 2.0. `sections/product-info.liquid`
   assumes Dawn-style two-column product markup. If your theme is a legacy
   Online Store 1.x theme, the snippets still work but the sections need a
   layout wrapper.
2. **Brand name.** `MARLOW` is a placeholder in the preview. Swap the header
   logo and footer wordmark.
3. **Product type.** Placeholder copy assumes home goods: ceramics, textiles,
   objects. Copy is theme-editor editable on every section.
4. **Imagery.** Image generation was unavailable in my environment, so every
   photo slot is a self-contained SVG placeholder in a neutral duotone. Replace
   each `<div data-art="...">` with a real `<img>` using the same aspect box
   (4:5 for product and tiles, 16:9 for hero and editorial). No CSS changes
   are needed.
5. **Checkout.** The cart drawer's Checkout button points to Shopify's hosted
   checkout. No custom checkout logic is introduced.
6. **Fonts.** Inter and Fraunces are loaded in the preview from Google Fonts. In
   production, either upload the font files to `assets/` or use Shopify's font
   service so font loading stays same-origin.

## What I need from you to apply this

1. Collaborator access to the store, or the theme exported as a `.zip`.
2. The theme name and whether it is Dawn, a paid OS 2.0 theme, or custom.
3. The collection hierarchy you want in the menu.
4. Real product photography, or confirmation that I should proceed with the
   neutral placeholders for the first review pass.
5. Any existing page builder apps. If PageFly, GemPages or Shogun are in use I
   will either replace the templates or scope the work to the apps' edit areas.

## Notes on choices I made

- **Hairline borders instead of shadows.** At this kind of minimal spec, soft
  shadows read as heavy. `--sh-1` exists but is barely used; most separation
  comes from a 1px `#e6e6e2` rule.
- **Monochrome accent.** The CTA is near-black on white and inverts on hover.
  Adding a brand colour later is a one-token change to `--c-accent`.
- **Serif only for the hero.** One serif voice on the hero and editorial
  headline, sans everywhere else. Two full type systems reads busy.
- **Quick add only on single-variant products.** Multi-variant cards link to the
  product page instead of guessing a variant. This keeps the bag clean and the
  three-click rule honest.
- **No third-party dependency.** No jQuery, no cart app, no animation library.
  The kit is self-sufficient so the performance budget is predictable.
