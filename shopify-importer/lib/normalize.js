'use strict';

/**
 * Normalise supplier rows into Shopify's native product CSV shape plus an
 * image CSV, so the same output can be pushed through Shopify's CSV importer
 * or the Admin API.
 *
 * One input row = one variant. Rows are grouped into products by `handle`
 * when present, otherwise by normalised title.
 */

const PRODUCT_COLUMNS = [
  'handle',
  'title',
  'body_html',
  'tags',
  'status',
  'vendor',
  'product_type',
  'variant_sku',
  'variant_grams',
  'variant_inventory_tracker',
  'variant_inventory_policy',
  'variant_price',
  'variant_image',
  'variant_weight',
  'variant_weight_unit',
  'variant_compare_at_price',
  'variant_requires_shipping',
  'variant_taxable',
  'variant_barcode',
  'collection_list',
  'option1_name',
  'option1_value',
  'option2_name',
  'option2_value',
  'option3_name',
  'option3_value',
  'variant_position',
  'variant_status',
  'seo_title',
  'seo_description',
  'image_position',
  'image_src',
  'src',
  'alt',
  'gift_card',
  'template_suffix',
  'quantity_less_than'
];

const IMAGE_COLUMNS = ['image_id', 'image_position', 'image_src', 'image_alt', 'src', 'alt', 'delete_image_id'];

const WEIGHT_UNITS = { g: 1, gram: 1, grams: 1, kg: 1000, lbs: 453.592, oz: 28.3495, lb: 453.592 };

const FIELD_ALIASES = {
  title: ['title', 'product_title', 'item_title', 'name', 'product_name'],
  handle: ['handle', 'product_handle', 'slug'],
  body_html: ['description', 'body_html', 'details', 'product_description', 'desc'],
  tags: ['tags', 'tag_list'],
  status: ['status', 'publish', 'product_status', 'published'],
  vendor: ['vendor', 'supplier', 'brand', 'supplier_name', 'manufacturer'],
  product_type: ['product_type', 'type', 'category', 'cat', 'collection', 'product_category'],
  variant_sku: ['variant_sku', 'sku', 'sku_code', 'product_sku', 'item_sku'],
  variant_price: ['variant_price', 'price', 'retail_price', 'retail', 'unit_price', 'sale_price', 'rrp', 'list_price'],
  variant_compare_at_price: ['variant_compare_at_price', 'compare_at_price', 'original_price', 'msrp', 'compare_price', 'was_price'],
  variant_inventory_tracker: ['variant_inventory_tracker', 'inventory_tracker'],
  variant_inventory_policy: ['variant_inventory_policy', 'inventory_policy'],
  variant_weight: ['variant_weight', 'weight', 'wt', 'weight_grams'],
  variant_weight_unit: ['variant_weight_unit', 'weight_unit', 'unit'],
  variant_barcode: ['variant_barcode', 'barcode', 'ean', 'gtin', 'upc'],
  variant_status: ['variant_status', 'variant_publish', 'variant_state'],
  collection_list: ['collection_list', 'collections'],
  variant_requires_shipping: ['variant_requires_shipping', 'requires_shipping'],
  variant_taxable: ['variant_taxable', 'taxable'],
  variant_position: ['variant_position', 'position'],
  option1_name: ['option1_name', 'opt1_name', 'option_1_name'],
  option1_value: ['option1_value', 'opt1_value', 'size', 'option_1_value'],
  option2_name: ['option2_name', 'opt2_name', 'option_2_name'],
  option2_value: ['option2_value', 'opt2_value', 'colour', 'color', 'option_2_value'],
  option3_name: ['option3_name', 'opt3_name', 'option_3_name'],
  option3_value: ['option3_value', 'opt3_value', 'option_3_value'],
  image_src: ['image_src', 'image', 'image_url', 'images', 'pictures', 'photos', 'photo', 'pic_url', 'image_link'],
  image_alt: ['image_alt', 'alt', 'image_alt_text'],
  seo_title: ['seo_title'],
  seo_description: ['seo_description']
};

function resolveFields(headers) {
  const lower = {};
  headers.forEach((h) => {
    lower[h] = h.toLowerCase();
    lower[h.trim()] = h.toLowerCase();
  });

  const map = {};
  for (const canonical of Object.keys(FIELD_ALIASES)) {
    for (const alias of FIELD_ALIASES[canonical]) {
      const hit = headers.find((h) => lower[h] === alias);
      if (hit !== undefined) {
        map[canonical] = hit;
        break;
      }
    }
  }
  return map;
}

function pick(row, map, canonical) {
  const key = map[canonical];
  if (!key) return '';
  const v = row[key];
  return v === undefined || v === null ? '' : String(v);
}

function parsePrice(raw) {
  if (raw === '' || raw === undefined || raw === null) return '';
  let s = String(raw)
    .replace(/[^0-9.,\-]/g, '')
    .trim();

  const sign = s.startsWith('-') ? '-' : '';
  if (sign) s = s.slice(1);
  if (!s || s === '.' || s === ',') return '';

  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    // European thousands + decimal comma: 1.234,56
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) {
    // Thousands separators only, no decimal part: 1,234 / 1.234
    s = s.replace(/[.,]/g, '');
  } else if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
    // Decimal comma: 9,50
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }

  const n = Number(sign + s);
  if (!Number.isFinite(n) || n < 0) return '';
  return n.toFixed(2);
}

function toGrams(value, unit) {
  if (value === '' || value === undefined || value === null) return '';
  const n = Number(String(value).trim().replace(/[^0-9.eE+\-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  const factor = WEIGHT_UNITS[String(unit || '').toLowerCase().trim()] || 1;
  return Math.round(n * factor);
}

function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
}

function looksLikeHtml(text) {
  return /<[a-z][\s\S]*>/i.test(text);
}

function wrapHtml(text) {
  if (!text) return '';
  if (looksLikeHtml(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function truncate(s, max, suffix) {
  const end = suffix || '';
  if (!s || s.length <= max) return s;
  return s.slice(0, Math.max(0, max - end.length)).replace(/\s+\S*$/, '') + end;
}

function splitList(raw, delimiters) {
  return String(raw || '')
    .split(delimiters)
    .map((s) => s.trim())
    .filter(Boolean);
}

function optionKey(row, map, opts) {
  const names = opts.optionNames || [];
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const nameField = `option${i + 1}_name`;
    const valueField = `option${i + 1}_value`;
    const name = pick(row, map, nameField) || (names[i] || '');
    const value = pick(row, map, valueField);
    parts.push({ name, value });
  }
  return parts;
}

/**
 * @param {Array<Object>} rows   input rows, one per variant
 * @param {Object}       opts
 *   - optionNames:  ['Size', 'Colour', 'Fit']
 *   - defaultVendor, defaultStatus, defaultRequiresShipping, defaultTaxable
 *   - imageDelimiters
 * @returns {{ products: Array<Object>, images: Array<Object>, stats: Object, errors: Array<Object> }}
 */
function normalize(rows, opts) {
  const o = Object.assign(
    {
      optionNames: ['Size', 'Colour', 'Fit'],
      defaultVendor: '',
      defaultStatus: 'active',
      defaultRequiresShipping: 'true',
      defaultTaxable: 'true',
      defaultInventoryPolicy: 'continue',
      imageDelimiters: /[,;\n|]+/,
      seoTitleLimit: 70,
      seoDescriptionLimit: 300,
      deduplicateVariants: true,
      linkHandlelessRows: true
    },
    opts || {}
  );

  const errors = [];
  const headerSample = rows[0] || {};
  const map = resolveFields(Object.keys(headerSample));

  if (!map.title) {
    errors.push({ line: 0, code: 'E_NO_TITLE', message: 'No title column found. Add a `title` column.' });
    return {
      products: [],
      images: [],
      stats: {
        inputRows: rows.length,
        products: 0,
        variants: 0,
        images: 0,
        droppedDuplicates: 0,
        droppedMalformed: 0,
        fieldMap: map
      },
      errors
    };
  }

  const groups = new Map(); // handle -> group
  let prevGroup = null;
  let droppedDuplicates = 0;
  let droppedMalformed = 0;
  const seenVariantKeys = new Set();

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const line = idx + 2; // +1 header, +1 one-based
    const title = pick(row, map, 'title').trim();

    if (!title) {
      errors.push({ line, code: 'E_EMPTY_TITLE', message: 'Row has no title, skipped.' });
      droppedMalformed++;
      continue;
    }

    const rawHandle = pick(row, map, 'handle').trim();
    const titleKey = slugify(title);
    const baseHandle = slugify(rawHandle) || titleKey;
    if (!baseHandle) {
      errors.push({ line, code: 'E_BAD_HANDLE', message: `Cannot derive handle from title "${title}".` });
      droppedMalformed++;
      continue;
    }

    let group = groups.get(baseHandle);

    if (!group && !rawHandle && o.linkHandlelessRows && prevGroup && prevGroup.titleKey === titleKey) {
      // No handle on this row, and no group under the title slug. Supplier
      // exports usually carry the handle only on a product's first row and list
      // its variants straight after; when the previous row belongs to a group
      // with this same title, join it instead of splitting the product.
      group = prevGroup;
    }

    if (!group) {
      group = {
        handle: baseHandle,
        titleKey,
        title,
        vendor: '',
        product_type: '',
        body_html: '',
        tags: '',
        status: '',
        collection_list: '',
        template_suffix: '',
        gift_card: '',
        variant_taxable: '',
        seo_title: '',
        seo_description: '',
        variants: [],
        images: [],
        imageSeen: new Set()
      };
      groups.set(baseHandle, group);
    }

    prevGroup = group;

    if (!group.body_html) group.body_html = wrapHtml(pick(row, map, 'body_html'));
    if (!group.vendor) group.vendor = pick(row, map, 'vendor');
    if (!group.product_type) group.product_type = pick(row, map, 'product_type');
    if (!group.collection_list) group.collection_list = pick(row, map, 'collection_list');
    if (!group.template_suffix) group.template_suffix = pick(row, map, 'template_suffix');
    if (!group.gift_card) group.gift_card = pick(row, map, 'gift_card');
    if (!group.tags) group.tags = pick(row, map, 'tags');
    if (!group.status) group.status = pick(row, map, 'status');
    if (!group.variant_taxable) group.variant_taxable = pick(row, map, 'variant_taxable');
    if (!group.seo_title) group.seo_title = pick(row, map, 'seo_title');
    if (!group.seo_description) group.seo_description = pick(row, map, 'seo_description');

    const price = parsePrice(pick(row, map, 'variant_price'));
    if (!price) {
      errors.push({ line, code: 'E_NO_PRICE', message: `Variant of "${title}" has no usable price, skipped.` });
      droppedMalformed++;
      continue;
    }

    const options = optionKey(row, map, o);
    const sku = pick(row, map, 'variant_sku').trim();
    const variantIdentity = sku
      ? `sku:${sku.toLowerCase()}`
      : `opts:${options.map((p) => `${p.name}|${p.value}`).join('>>').toLowerCase()}`;

    if (o.deduplicateVariants) {
      if (seenVariantKeys.has(variantIdentity)) {
        errors.push({
          line,
          code: 'W_DUPLICATE_VARIANT',
          message: `Duplicate variant of "${title}" (${sku || options.map((p) => p.value).join('/')}), dropped.`
        });
        droppedDuplicates++;
        continue;
      }
      seenVariantKeys.add(variantIdentity);
    }

    const rowImages = splitList(pick(row, map, 'image_src'), o.imageDelimiters);
    for (const src of rowImages) {
      if (!group.imageSeen.has(src)) {
        group.imageSeen.add(src);
        group.images.push(src);
      }
    }

    group.variants.push({
      line,
      variant_sku: sku,
      variant_price: price,
      variant_compare_at_price: parsePrice(pick(row, map, 'variant_compare_at_price')),
      variant_inventory_tracker: pick(row, map, 'variant_inventory_tracker') || '',
      variant_inventory_policy: pick(row, map, 'variant_inventory_policy') || o.defaultInventoryPolicy,
      variant_weight: pick(row, map, 'variant_weight'),
      variant_weight_unit: pick(row, map, 'variant_weight_unit'),
      variant_barcode: pick(row, map, 'variant_barcode'),
      variant_status: pick(row, map, 'variant_status') || o.defaultStatus,
      variant_requires_shipping: pick(row, map, 'variant_requires_shipping') || o.defaultRequiresShipping,
      variant_taxable: pick(row, map, 'variant_taxable') || o.defaultTaxable,
      variant_position: pick(row, map, 'variant_position') || String(group.variants.length + 1),
      option1_name: options[0] && options[0].name,
      option1_value: options[0] ? options[0].value : '',
      option2_name: options[1] && options[1].name,
      option2_value: options[1] ? options[1].value : '',
      option3_name: options[2] && options[2].name,
      option3_value: options[2] ? options[2].value : '',
      image_src: rowImages[0] || '',
      image_alt: pick(row, map, 'image_alt') || title,
      options
    });
  }

  const products = [];
  const images = [];

  for (const group of groups.values()) {
    if (!group.variants.length) {
      groups.delete(group.handle);
      continue;
    }

    group.variants.sort((a, b) => Number(a.variant_position) - Number(b.variant_position) || a.line - b.line);

    const variantRows = group.variants.map((v, i) => {
      const grams = toGrams(v.variant_weight, v.variant_weight_unit);
      return {
        handle: group.handle,
        title: group.title,
        body_html: group.body_html,
        vendor: group.vendor || o.defaultVendor,
        product_type: group.product_type,
        tags: group.tags,
        status: group.status || o.defaultStatus,
        variant_sku: v.variant_sku,
        variant_grams: grams,
        variant_inventory_tracker: v.variant_inventory_tracker,
        variant_inventory_policy: v.variant_inventory_policy,
        variant_price: v.variant_price,
        variant_image: v.image_src,
        variant_weight: grams,
        variant_weight_unit: grams ? 'g' : '',
        variant_compare_at_price: v.variant_compare_at_price,
        variant_requires_shipping: v.variant_requires_shipping,
        variant_taxable: v.variant_taxable || group.variant_taxable || o.defaultTaxable,
        variant_barcode: v.variant_barcode,
        collection_list: group.collection_list,
        option1_name: v.option1_name,
        option1_value: v.option1_value,
        option2_name: v.option2_name,
        option2_value: v.option2_value,
        option3_name: v.option3_name,
        option3_value: v.option3_value,
        variant_position: String(i + 1),
        variant_status: v.variant_status,
        seo_title: truncate(group.seo_title || group.title, o.seoTitleLimit, '…'),
        seo_description: truncate(group.seo_description || firstSentence(group.body_html), o.seoDescriptionLimit, '…'),
        image_position: v.image_src ? '1' : '',
        image_src: v.image_src,
        src: v.image_src,
        alt: v.image_alt,
        gift_card: group.gift_card,
        template_suffix: group.template_suffix,
        quantity_less_than: ''
      };
    });

    products.push(...variantRows);

    group.images.forEach((src, i) => {
      images.push({
        image_id: '',
        image_position: String(i + 1),
        image_src: src,
        image_alt: i === 0 ? group.title : `${group.title} - photo ${i + 1}`,
        src,
        alt: i === 0 ? group.title : `${group.title} - photo ${i + 1}`,
        delete_image_id: ''
      });
    });
  }

  return {
    products,
    images,
    stats: {
      inputRows: rows.length,
      products: groups.size,
      variants: products.length,
      images: images.length,
      droppedDuplicates,
      droppedMalformed,
      fieldMap: map
    },
    errors
  };
}

function firstSentence(html) {
  const text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = text.indexOf('. ');
  return cut > 0 && cut < 300 ? text.slice(0, cut + 1) : text;
}

module.exports = { normalize, parsePrice, toGrams, slugify, resolveFields, FIELD_ALIASES, PRODUCT_COLUMNS, IMAGE_COLUMNS };
