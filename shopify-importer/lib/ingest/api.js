'use strict';

/**
 * Pull rows from a supplier's own API using a declarative JSON config.
 *
 * This is the sanctioned route for machine-readable supplier data: you ask for
 * it through an interface they expose, you respect their pagination and rate
 * limits, and you never touch their storefront.
 *
 * Config shape (see examples/api-supplier.json):
 *   baseUrl, path, method, headers, body, pageSize, pageParam, itemsPath,
 *   cursorParam, cursorPath, hasMorePath, delayMs, timeoutMs, attempts, maxPages
 *
 * Field values support ${ENV_VAR} interpolation.
 */

const http = require('http');
const https = require('https');
const { sleep } = require('../shopify/client');

function interpolate(value, env = process.env) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    const found = env[name];
    if (found === undefined) {
      throw new Error(`Environment variable ${name} is not set. Export it before running the API ingest.`);
    }
    return found;
  });
}

function interpolateDeep(obj, env) {
  if (obj === null || typeof obj !== 'object') return interpolate(obj, env);
  if (Array.isArray(obj)) return obj.map((v) => interpolateDeep(v, env));
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = interpolateDeep(v, env);
  return out;
}

/** Resolve `$.a.b`, `$.a[0].b`, or a plain `a.b` path. */
function resolve(obj, expr) {
  if (!expr) return obj;
  let cur = obj;
  for (const token of String(expr).replace(/^\$\.?/, '').split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    const indexed = /^(.+?)\[(\d+)\]$/.exec(token);
    if (indexed) {
      cur = cur[indexed[1]];
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(indexed[2])];
      continue;
    }
    cur = cur[token];
  }
  return cur;
}

function fetchOnce(url, { method, headers, body, timeoutMs }, env) {
  const u = new URL(url);
  const lib = u.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method,
        timeout: timeoutMs,
        headers: headers || {}
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(
            fetchOnce(
              new URL(res.headers.location, url).toString(),
              { method, headers, body, timeoutMs },
              env
            )
          );
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          const err = new Error(`${method} ${url} -> HTTP ${res.statusCode}`);
          err.status = res.statusCode;
          err.retryAfter = res.headers['retry-after'];
          reject(err);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new Error(`Response from ${url} is not JSON (first 120 chars: ${text.slice(0, 120)})`));
          }
        });
        res.on('error', reject);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms: ${url}`));
    });
    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * @param {Object} config
 * @returns {Promise<{rows: Array<Object>, pages: number, requests: number}>}
 */
async function fetchFromApi(config, opts = {}) {
  const env = Object.assign({}, process.env, opts.env || {});
  const c = {
    pageSize: 50,
    pageParam: 'page',
    pageStart: 1,
    method: 'GET',
    timeoutMs: 20000,
    delayMs: 250,
    attempts: 3,
    maxPages: 200,
    backoffMs: 1000,
    ...config
  };

  if (!c.baseUrl || !c.path) throw new Error('API config requires baseUrl and path');
  if (!c.itemsPath) throw new Error('API config requires itemsPath, e.g. "$.data.products"');

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'ShopifyImporter/1.0',
    ...(c.headers ? interpolateDeep(c.headers, env) : {})
  };
  let cursor = c.cursorStart || null;
  let page = c.pageStart;
  let requests = 0;
  const rows = [];

  for (let guard = 0; guard < c.maxPages; guard++) {
    const u = new URL(c.path, c.baseUrl);
    if (c.cursorParam && cursor !== null) u.searchParams.set(c.cursorParam, cursor);
    else if (c.pageParam) u.searchParams.set(c.pageParam, String(page));
    if (c.pageSizeParam && c.pageSize) u.searchParams.set(c.pageSizeParam, String(c.pageSize));
    if (c.query) {
      for (const [k, v] of Object.entries(interpolateDeep(c.query, env))) u.searchParams.set(k, String(v));
    }

    const body = c.body ? interpolateDeep(c.body, env) : undefined;

    let json = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= c.attempts; attempt++) {
      try {
        json = await fetchOnce(u.toString(), { method: c.method, headers, body, timeoutMs: c.timeoutMs }, env);
        break;
      } catch (err) {
        lastErr = err;
        const retryable = err.status === 429 || (err.status >= 500 && err.status < 600);
        if (!retryable || attempt === c.attempts) throw err;
        const wait = err.retryAfter ? Number(err.retryAfter) * 1000 : c.backoffMs * 2 ** (attempt - 1);
        await sleep(wait);
      }
    }
    requests++;

    let items = resolve(json, c.itemsPath);
    if (!Array.isArray(items)) {
      items = resolve(json, '$.data') && Array.isArray(resolve(json, '$.data')) ? resolve(json, '$.data') : null;
      if (!Array.isArray(items)) {
        throw new Error(
          `itemsPath "${c.itemsPath}" did not resolve to an array. Response keys: ${Object.keys(json || {}).join(', ') || '(none)'}`
        );
      }
    }
    rows.push(...items);

    if (items.length < c.pageSize) break;

    const hasMore = c.hasMorePath ? resolve(json, c.hasMorePath) : true;
    if (hasMore === false || hasMore === 'false' || hasMore === 0) break;

    if (c.cursorParam && c.cursorPath) {
      const next = resolve(json, c.cursorPath);
      if (!next) break;
      cursor = next;
    } else {
      page += 1;
    }

    if (c.delayMs > 0) await sleep(c.delayMs);
  }

  if (rows.length && requests > 0) {
    const first = rows[0];
    const sample = Object.keys(first).slice(0, 12).join(', ');
    process.stderr.write(`  fetched ${rows.length} rows over ${requests} request(s) from ${c.baseUrl}${c.path} [fields: ${sample}]\n`);
  }

  return { rows, pages: requests };
}

module.exports = { fetchFromApi, resolve, interpolate, interpolateDeep };
