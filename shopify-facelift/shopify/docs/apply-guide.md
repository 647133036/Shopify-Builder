# Applying the Neutral Minimal Facelift to a Live Shopify Theme

All steps are additive. Nothing existing is overwritten, so every change can be
reverted by deleting the files listed in step 1.

## 0. Prerequisites

- Theme is Shopify OS 2.0 (Dawn, Debut, a paid theme built on OS 2.0, or any
  theme with `sections/`, `snippets/`, `assets/` and `theme.liquid`).
- Duplicate the live theme first in the admin:
  **Online Store > Themes > ... > Duplicate**. Work on the copy.

## 1. Add the assets

Upload these two files to the theme, unmodified:

| File | Goes to |
| --- | --- |
| `assets/brand.css` | `assets/brand.css` |
| `assets/facelift.js` | `assets/facelift.js` |

In the theme editor: **Theme code > Assets > Add a new asset**. `brand.css` is
roughly 1000 lines; paste it whole. If you use the Shopify CLI, it is faster:

```bash
shopify theme pull --path theme
shopify theme push --theme <id> assets/brand.css assets/facelift.js
```

## 2. Link them from `theme.liquid`

Open **Theme code > theme.liquid** and add the following inside `<head>`,
after any existing stylesheet tags so these rules win the cascade:

```html
<style>
  :root {
    --c-bg: {{ settings.fl_bg | default: '#ffffff' }};
    --c-bg-soft: {{ settings.fl_bg_soft | default: '#fafaf8' }};
    --c-surface: {{ settings.fl_surface | default: '#f4f4f1' }};
    --c-ink: {{ settings.fl_ink | default: '#131312' }};
    --c-ink-2: {{ settings.fl_ink_2 | default: '#4b4b47' }};
    --c-ink-3: {{ settings.fl_ink_3 | default: '#8b8b85' }};
    --c-line: {{ settings.fl_line | default: '#e6e6e2' }};
    --c-accent: {{ settings.fl_accent | default: '#131312' }};
  }
</style>
<link rel="stylesheet" href="{{ 'brand.css' | asset_url }}">
<script src="{{ 'facelift.js' | asset_url }}" defer></script>
```

The `<style>` block is optional but keeps colour changes in the theme editor
instead of inside a stylesheet. Everything below the theme's own CSS on purpose.

## 3. Add the settings

Open **Theme code > config/settings_schema.json**. The file is a JSON array of
groups. Add the group from `config/settings_schema.json` in this kit as another
element of that array. The settings appear under **Theme settings > Facelift
· Neutral Minimal**.

`config/settings_data.json` holds the palette defaults. Merge its `current` keys
into your theme's existing `current` object if you want to ship them as-is, or
leave it out and set colours by hand.

## 4. Add the snippets and sections

Upload unmodified:

- `snippets/trust-badges.liquid`
- `snippets/variant-selector.liquid`
- `snippets/product-card.liquid`
- `sections/home-hero.liquid`
- `sections/home-collection-tiles.liquid`
- `sections/home-featured-products.liquid`
- `sections/product-media.liquid`
- `sections/product-info.liquid`

If your theme is **Dawn**, `snippets/product-card.liquid` already uses the same
`card_product` convention Dawn's grid sections use, so it can also drop into
Dawn's existing product grid by swapping the include line.

## 5. Set the fonts

**Theme settings > Typography.** The neutral minimal look reads best with one
grotesque for everything plus one light serif for the hero headline only.

- Sans (everything): Inter, or Neue Haas Grotesk Text if you license it.
- Serif (hero and editorial headlines): Fraunces 300, or a light display serif.
- If you keep only one font, set the serif slot to the sans and set
  `--font-serif` to the same stack in the `<style>` block from step 2.

The hero uses `--font-serif` via `.hero__title` and `.editorial__title`. All
other text uses `--font-sans`.

## 6. Build the four templates

Create or replace the section layout of these four templates.

### `templates/index.json` — home

Section order, top to bottom:

1. Announcement bar (your theme's existing one, or the `.announce` div from the preview)
2. Header (existing)
3. `home-hero`
4. `home-collection-tiles`
5. `home-featured-products`
6. Editorial band (any rich text or image section, styled with `.editorial`)
7. `home-featured-products` again, pointed at a *New arrivals* collection
8. Footer (existing)

### `templates/product.json` — product

Use a two-column layout for the two product sections:

```json
{
  "sections": {
    "main": {
      "type": "layout-two-column",
      "settings": { "columns": "1.15fr 1fr" }
    }
  }
}
```

Then place `product-media` on the left and `product-info` on the right, and add
a second product grid below for *Pairs well with*.

If your theme has no two-column layout section, use Dawn's `main-product` layout
pattern: nest both sections inside a single `section` with
`class="product-grid"` and set `display: grid; grid-template-columns: 1.15fr 1fr;`
on it. The `.pdp` class in `brand.css` already defines exactly that grid.

### `templates/collection.json` — collection

Collection heading, toolbar with filters and sort, then a product grid using
`snippets/product-card.liquid`. In Dawn, `main-collection-product-grid` already
does this — point it at a 4-column grid and swap the card include.

### `templates/cart.json` — cart

Cart line list on the left, order summary on the right. The `.cart-layout`,
`.cart-lines`, `.cart-line` and `.summary` classes in `brand.css` style the
standard Dawn cart markup as-is, so no restructuring is needed.

## 7. Navigation

Three-click landing-to-checkout means the home page must surface a product
directly. Check all of these:

- Home page has a `home-featured-products` section near the top.
- Header menu links go to *collections*, never to nested landing pages.
  Max two levels: `Shop > Ceramics > product`.
- Menu order: Shop, top three collections, Our story, Journal.
- Footer repeats Shop links so deep pages stay one tap from a product.
- Cart drawer enabled, with Checkout reachable from the drawer. With quick add on
  single-variant cards the path is: home > quick add > checkout, two clicks.

Shopify caps the main menu at 20 items including children. Keep it under 8.

## 8. Performance budget

The system is built to stay light. Targets:

| Metric | Target |
| --- | --- |
| CSS added by this kit | 30 KB, ~7 KB gzipped |
| JS added by this kit | 7 KB, ~2.5 KB gzipped |
| Lighthouse Performance (mobile) | 90+ |
| LCP | under 2.5 s |
| CLS | under 0.1 |

To stay inside that budget:

- Do not add a page builder on top. PageFly, GemPages and Shogun each add their
  own runtime, which doubles what this kit removes.
- `product-media` requests images at `width: 1600` for the gallery and
  `width: 200` for thumbnails, both lazy except the first image.
- `home-hero` marks its image `loading="eager"` and `fetchpriority="high"` because
  it is the LCP element.
- Every image tag carries a `widths` list and a responsive `sizes` attribute.
  Shopify serves WebP/AVIF automatically.
- Skip decorative motion. `brand.css` has no animations beyond hover
  transitions and one reveal hook, and it honours `prefers-reduced-motion`.
- Aim for under 250 KB of JavaScript total on the product page.

## 9. QA checklist before going live

Desktop, then repeat at 390 x 844:

- [ ] Home: hero, tiles, featured grid, editorial, footer. No horizontal scroll.
- [ ] Collection: 4-up grid on desktop, 2-up on tablet, 2-up on phone. Filter
      chips and sort both work. Breadcrumb reads correctly.
- [ ] Product: gallery sticky on desktop, thumbnail switching works, all option
      styles render, price updates on variant change, quantity stepper works,
      add to bag works, trust row shows, accordions expand and collapse.
- [ ] Cart: line quantities change, remove works, discount field renders, totals
      recalculate, empty state appears.
- [ ] Drawer opens from any page, badge count matches the bag.
- [ ] Every product is reachable from the home page in three clicks or fewer.
- [ ] Lighthouse run on the product page on mobile: Performance 90+, CLS under 0.1.
- [ ] Keyboard: every interactive element is reachable and shows a visible focus
      ring. The skip link works.

## 10. Rollback

Delete the two assets, remove the `<head>` block from step 2, remove the four
sections and three snippets, and delete the settings group from
`settings_schema.json`. The theme returns to its previous state.
