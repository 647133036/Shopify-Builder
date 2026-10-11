'use strict';

/**
 * Minimal Shopify REST + GraphQL client.
 * No dependencies. Serialises writes (Shopify throttles ~2 req/s on most
 * admin endpoints), honours 429 Retry-After, and retries transient failures.
 */

const https = require('https');

const API_VERSION = '2025-01';

function request(url, { method = 'GET', body, headers = {}, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const h = Object.assign({ 'Content-Type': 'application/json' }, headers);
    if (payload && !h['Content-Type']) h['Content-Type'] = 'application/json';

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: h,
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode;
          let json = null;
          if (text) {
            try {
              json = JSON.parse(text);
            } catch (err) {
              /* non-JSON body */
            }
          }
          if (status >= 200 && status < 300) {
            resolve({ status, data: json, text });
            return;
          }
          const err = new Error(`${method} ${u.pathname} -> ${status}`);
          err.status = status;
          err.data = json;
          err.retryAfter = res.headers['retry-after'];
          err.body = text.slice(0, 800);
          reject(err);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms: ${method} ${url}`));
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

class Shopify {
  constructor({ shop, token, apiVersion = API_VERSION, baseUrl = null }) {
    if (!shop || !token) throw new Error('shop and token are required');
    this.shop = String(shop).replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!/myshopify\.com/i.test(this.shop)) {
      this.shop = `${this.shop}.myshopify.com`;
    }
    this.token = token;
    this.apiVersion = apiVersion;
    this.adminRoot = baseUrl || `https://${this.shop}/admin/api/${this.apiVersion}`;
    this.storefrontRoot = baseUrl
      ? baseUrl.replace(/\/admin\/api\/.*/, '/api')
      : `https://${this.shop}/api`;
  }

  _headers(extra = {}) {
    return Object.assign({ 'X-Shopify-Access-Token': this.token }, extra);
  }

  async get(path, extra = {}) {
    return request(`${this.adminRoot}${path}`, { method: 'GET', headers: this._headers(extra.headers) });
  }

  async post(path, body, extra = {}) {
    return request(`${this.adminRoot}${path}`, {
      method: 'POST',
      body,
      headers: this._headers(extra.headers)
    });
  }

  async put(path, body, extra = {}) {
    return request(`${this.adminRoot}${path}`, { method: 'PUT', body, headers: this._headers(extra.headers) });
  }

  /**
   * POST an already-encoded form body. Used for binary asset uploads where the
   * payload is a base64 `asset[asset][body]` field.
   */
  async postForm(path, raw, extra = {}) {
    return request(`${this.adminRoot}${path}`, {
      method: 'POST',
      body: raw,
      headers: this._headers(Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, extra.headers || {}))
    });
  }

  async graphql(shop) {
    const { query, variables } = shop || {};
    if (!query) throw new Error('graphql() requires a query');
    return request(`${this.storefrontRoot}/${this.apiVersion}/graphql.json`, {
      method: 'POST',
      body: { query, variables: variables || {} },
      headers: this._headers({ 'X-Shopify-Version': this.apiVersion })
    });
  }

  /**
   * Verify credentials and return shop name. Fails fast before any upload work.
   */
  async whoami() {
    const { data } = await this.get('/shops/current.json');
    return data.shop;
  }
}

/**
 * Run async operations through a serial lane so write-heavy endpoints do not
 * trip Shopify's request budget.
 */
function serialLane(limit = 1) {
  let chain = Promise.resolve();
  let active = 0;

  function lane(fn) {
    const run = chain.then(async () => {
      while (active >= limit) {
        await new Promise((r) => setTimeout(r, 250));
      }
      active++;
      try {
        return await fn();
      } finally {
        active--;
      }
    });
    chain = run.catch(() => {});
    return run;
  }

  return lane;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry wrapper: backoff on 5xx, 429 (honouring Retry-After), and network errors.
 */
async function withRetry(fn, opts) {
  const o = Object.assign({ attempts: 3, baseMs: 1200, maxMs: 20000, label: 'operation' }, opts || {});
  let lastErr;
  for (let attempt = 0; attempt < o.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.status || (Number(/^(\d{3})\b/.exec(err.message || '')) || 0);
      const retryable =
        status === 429 ||
        (status >= 500 && status < 600) ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        /\b(5\d\d|429)\b/.test(err.message || '');
      if (!retryable || attempt === o.attempts - 1) throw err;
      const backoff = err.retryAfter ? Number(err.retryAfter) * 1000 : Math.min(o.maxMs, o.baseMs * 2 ** attempt);
      if (process.env.SHOPIFY_IMPORTER_VERBOSE === '1') {
        console.error(`  ! ${o.label}: ${err.message}; retrying in ${backoff}ms`);
      }
      await sleep(backoff);
    }
  }
  throw lastErr;
}

module.exports = { Shopify, request, serialLane, withRetry, sleep };
