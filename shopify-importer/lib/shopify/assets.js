'use strict';

/**
 * Upload processed image bytes to the store's own asset server.
 *
 * Shopify's imageUpload endpoint requires the image to be reachable over the
 * public internet, which a local working folder is not. Theme asset uploads
 * are binary, free, and served from your own domain at a /cdn/shop/t/ URL,
 * so they are a legitimate place to stage processed media before attaching it
 * to a product.
 */

const { withRetry } = require('./client');

function formEncode(obj) {
  return Object.keys(obj)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`)
    .join('&');
}

/**
 * @param {Object} client    Shopify client
 * @param {Buffer} buffer    image bytes
 * @param {Object} opts      { filename, contentType, attempts }
 * @returns {Promise<{url: string, id: number, bytes: number}>}
 */
async function uploadAsset(client, buffer, opts = {}) {
  const filename = opts.filename || 'imported.jpg';
  const contentType = opts.contentType || 'image/jpeg';

  const raw = formEncode({
    'asset[asset][content_type]': contentType,
    'asset[asset][body]': buffer.toString('base64'),
    'asset[asset][attachment]': filename
  });

  const { data } = await withRetry(
    () => client.postForm('/assets.json', raw),
    { attempts: opts.attempts || 3, label: `upload asset ${filename}` }
  );

  if (!data || !data.asset) throw new Error(`Asset upload returned no asset: ${JSON.stringify(data)}`);

  const url = data.asset.url;
  const absolute = /^https?:\/\//.test(url) ? url : `https://${client.shop}${url.startsWith('/') ? '' : '/'}${url}`;

  return { url: absolute, id: data.asset.id, bytes: buffer.length };
}

module.exports = { uploadAsset, formEncode };
