'use strict';

/**
 * Push normalised products to the Shopify Admin API.
 * Idempotent by handle: existing products are updated, new ones created.
 */

const { withRetry, serialLane } = require('./client');
const { uploadAsset } = require('./assets');

const WRITE_LANE = serialLane(1);

function groupByHandle(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.handle;
    if (!groups.has(key)) {
      groups.set(key, {
        handle: key,
        title: row.title,
        body_html: row.body_html,
        vendor: row.vendor || '',
        product_type: row.product_type || '',
        tags: row.tags || '',
        status: row.status || 'active',
        published: row.status !== 'draft' && row.status !== 'inactive',
        template_suffix: row.template_suffix || '',
        seo_title: row.seo_title || '',
        seo_description: row.seo_description || '',
        variants: [],
        images: []
      });
    }
    const g = groups.get(key);
    if (!g.tags && row.tags) g.tags = row.tags;
    g.variants.push(row);
    if (row.src && row.src !== g.images[g.images.length - 1]) g.images.push(row.src);
  }
  return [...groups.values()];
}

function toAdminVariants(variants) {
  return variants.map((v, i) => ({
    position: Number(v.variant_position) || i + 1,
    sku: v.variant_sku || null,
    barcode: v.variant_barcode || null,
    price: v.variant_price,
    compare_at_price: v.variant_compare_at_price || null,
    weight: v.variant_grams ? Number(v.variant_grams) : null,
    weight_unit: v.variant_weight_unit || 'g',
    inventory_policy: v.variant_inventory_policy || 'continue',
    inventory_management: v.variant_inventory_tracker === 'shopify' ? 'shopify' : '',
    requires_shipping: String(v.variant_requires_shipping).toLowerCase() !== 'false',
    taxable: String(v.variant_taxable).toLowerCase() !== 'false',
    option1: v.option1_value || null,
    option2: v.option2_value || null,
    option3: v.option3_value || null
  }));
}

function imageEntries(variants, imageResults, groupImages) {
  const bySrc = new Map();
  (imageResults || []).forEach((r) => {
    if (r && r.src && r.url) bySrc.set(r.src, r.url);
  });
  const altBySrc = new Map();
  variants.forEach((v) => {
    if (v.src && v.alt) altBySrc.set(v.src, v.alt);
  });

  const out = [];
  groupImages.forEach((src, i) => {
    out.push({ src: bySrc.has(src) ? bySrc.get(src) : src, alt: altBySrc.get(src) || null, position: i + 1 });
  });
  return out.filter((e) => e.src);
}

async function findExisting(client, handle) {
  const { data } = await withRetry(() => client.get(`/products.json?handle=${encodeURIComponent(handle)}`), {
    attempts: 2,
    label: `lookup ${handle}`
  });
  return (data.products || [])[0] || null;
}

/**
 * @param {Object} client        Shopify client
 * @param {Array}  rows          normalised variant rows (product CSV shape)
 * @param {Array}  imageResults  optional processed image results with .url
 * @param {Object} opts          { dryRun, stagedOnly }
 * @returns {Promise<Array>} one record per product
 */
async function syncProducts(client, rows, imageResults, opts = {}) {
  const groups = groupByHandle(rows);
  const results = [];
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi];
    const payload = {
      product: {
        title: group.title,
        body_html: group.body_html || '',
        vendor: group.vendor || null,
        product_type: group.product_type || null,
        tags: group.tags || '',
        status: group.status,
        published: group.published,
        published_at: group.published ? new Date().toISOString() : null,
        template_suffix: group.template_suffix || null,
        variants: toAdminVariants(group.variants)
      }
    };

    // SEO fields are predefined product metafields, exposed over REST as a
    // nested namespace.key object on the product resource.
    if (group.seo_title || group.seo_description) {
      payload.product.metafields = {};
      if (group.seo_title) payload.product.metafields['global.title_tag'] = group.seo_title;
      if (group.seo_description) payload.product.metafields['global.description_tag'] = group.seo_description;
    }

    const record = {
      handle: group.handle,
      title: group.title,
      variants: group.variants.length,
      action: null,
      id: null,
      images: null,
      error: null
    };

    if (opts.dryRun) {
      record.action = 'dry-run';
      record.payload = payload;
      results.push(record);
      onProgress(group.handle, 'dry-run', gi + 1, groups.length);
      continue;
    }

    try {
      const existing = await findExisting(client, group.handle);

      if (existing && opts.skipDuplicates) {
        record.action = 'skipped';
        record.id = existing.id;
        results.push(record);
        onProgress(group.handle, 'skipped', gi + 1, groups.length);
        continue;
      }

      let product;

      if (existing) {
        product = await WRITE_LANE(
          () => withRetry(() => client.put(`/products/${existing.id}.json`, payload), { label: `update ${group.handle}` })
        );
        record.action = 'updated';
      } else {
        product = await WRITE_LANE(
          () => withRetry(() => client.post('/products.json', payload), { label: `create ${group.handle}` })
        );
        record.action = 'created';
      }

      const productId = product.data && product.data.product && product.data.product.id;
      record.id = productId;
      record.product = product.data && product.data.product;

      const entries = imageEntries(group.variants, imageResults, group.images);
      if (!opts.skipImages && entries.length) {
        const uploaded = [];
        for (const entry of entries) {
          const img = await WRITE_LANE(
            () =>
              withRetry(
                () => client.post(`/products/${productId}/images.json`, { image: { src: entry.src, alt: entry.alt } }),
                { label: `attach image ${entry.src.slice(0, 60)}` }
              )
          );
          uploaded.push(img.data && img.data.image);
        }
        record.images = uploaded;
      } else {
        record.images = [];
      }
    } catch (err) {
      record.error = err.message;
      if (err.data) record.apiErrors = err.data;
    }

    results.push(record);
    onProgress(group.handle, record.action || 'error', gi + 1, groups.length);
  }

  return results;
}

module.exports = { syncProducts, groupByHandle, toAdminVariants, findExisting, imageEntries, uploadAsset };
