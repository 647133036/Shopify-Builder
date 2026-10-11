'use strict';

/**
 * Import jobs for the hosted app.
 *
 * A job is created immediately and answered to the client, then runs on a
 * single global lane so two merchants uploading at once cannot interleave
 * writes. Frontend polls for status rather than holding an open request,
 * because a live upload with images can take minutes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseToObjects } = require('../csv');
const { normalize, PRODUCT_COLUMNS } = require('../normalize');
const { stringify } = require('../csv');
const { run, rowsFromAny } = require('../run');
const { Shopify } = require('../shopify/client');
const { syncProducts } = require('../shopify/products');
const { uploadAsset } = require('../shopify/assets');
const dbmod = require('./db');

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const API_VERSION = '2024-10';

/**
 * Turn an uploaded file's text into an array of row objects. JSON input may
 * be a bare array or an object wrapping one (supplier APIs commonly return
 * { data: { products: [...] } }); anything else is parsed as CSV.
 */
function inputToRows(text, filename) {
  if (/\.json$/i.test(filename || '') || /^\s*[{[]/.test(text)) {
    return rowsFromAny(JSON.parse(text));
  }
  return parseToObjects(text, { trim: true });
}

function setProgress(job, stage, progress) {
  job.stage = stage;
  job.progress = Math.max(0, Math.min(100, Math.round(progress)));
}

function summarizeOutcome(records) {
  const counts = { created: 0, updated: 0, skipped: 0, 'dry-run': 0, error: 0 };
  for (const r of records) counts[r.action || 'error'] = (counts[r.action || 'error'] || 0) + 1;
  counts.failed = records.filter((r) => r.error).length;
  return { counts, records: records.slice(0, 200).map((r) => ({
    handle: r.handle,
    title: r.title,
    action: r.action,
    id: r.id,
    variants: r.variants,
    images: Array.isArray(r.images) ? r.images.length : r.images,
    error: r.error || null
  })) };
}

/**
 * Parse + normalise without touching Shopify. Returns the same shape the
 * preview screen renders: mapping, warnings, and a few sample product rows.
 */
function normalizePreview(text, opts = {}) {
  const o = Object.assign({
    optionNames: ['Size', 'Colour', 'Fit'],
    vendor: '',
    deduplicateVariants: true,
    linkHandlelessRows: true
  }, opts);

  const rows = inputToRows(text, opts.filename);
  const result = normalize(rows, {
    optionNames: o.optionNames,
    defaultVendor: o.vendor,
    deduplicateVariants: o.deduplicateVariants,
    linkHandlelessRows: o.linkHandlelessRows,
    imageDelimiters: /[,;\n|]+/
  });

  const preview = result.products.slice(0, 5).map((r) => ({
    handle: r.handle,
    title: r.title,
    variant_sku: r.variant_sku,
    variant_price: r.variant_price,
    option1_value: r.option1_value,
    option2_value: r.option2_value,
    option3_value: r.option3_value,
    variant_weight: r.variant_grams,
    variant_weight_unit: r.variant_weight_unit,
    src: r.src ? r.src.slice(0, 120) : ''
  }));

  return {
    ok: result.stats.droppedMalformed === 0 && result.errors.every((e) => e.level !== 'error'),
    stats: result.stats,
    errors: result.errors.map((e) => ({ line: e.line, code: e.code, message: e.message, level: e.level })),
    fieldMap: result.stats.fieldMap || {},
    products: preview,
    productsCsv: stringify(result.products, PRODUCT_COLUMNS),
    rowCount: rows.length
  };
}

/**
 * Verify a token without writing anything. shop.json is readable with any
 * admin token and reveals the store's name and plan.
 */
async function testConnection(shop, token) {
  const client = new Shopify({ shop, token, apiVersion: API_VERSION });
  const { data } = await client.get('/shop.json');
  const s = (data && data.shop) || {};
  return {
    ok: true,
    shop: s.name || shop,
    email: s.email || '',
    plan: (s.plan && s.plan.name) || '',
    currency: s.currency || '',
    url: s.url || `https://${shop}`
  };
}

function tempWorkDir(id) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `importer-${id}-`));
}

/**
 * Execute one job. `job` is the mutable record persisted to the database by
 * the caller on every stage change.
 */
async function executeJob(ctx, job, workDir) {
  const { db, secret, connection } = ctx;
  const rows = inputToRows(job.input, job.filename);
  setProgress(job, 'Parsed input', 5);
  persist(ctx, job);

  const opts = {
    outDir: path.join(workDir, 'out'),
    imagesDir: path.join(workDir, 'images'),
    processImages: !!job.processImages,
    optionNames: ['Size', 'Colour', 'Fit'],
    deduplicateVariants: true,
    linkHandlelessRows: true,
    skipDuplicates: !!job.skipDuplicates,
    maxDim: 2048,
    quality: 82,
    maxBytes: 700 * 1024
  };

  const { result, imageResults } = await run(rows, opts);
  setProgress(job, 'Normalised', 25);
  job.stats = JSON.stringify(result.stats);
  job.rows_in = rows.length;
  job.products = result.stats.products;
  job.variants = result.stats.variants;
  persist(ctx, job);

  if (job.mode === 'dry-run') {
    setProgress(job, 'Dry run complete', 100);
    job.outcome = JSON.stringify({ counts: { 'dry-run': result.stats.products }, dryRun: true, notes: 'Nothing was sent to Shopify.' });
    job.status = 'done';
    persist(ctx, job);
    return job;
  }

  if (!connection) throw new Error('No Shopify connection saved for this user.');

  const client = new Shopify({ shop: connection.shop, token: connection.token, apiVersion: API_VERSION });

  let staged = [];
  if (opts.processImages && imageResults.length) {
    setProgress(job, 'Staging images to the store CDN', 35);
    persist(ctx, job);
    let done = 0;
    for (const r of imageResults) {
      done += 1;
      if (r.error || !r.path || !fs.existsSync(r.path)) continue;
      try {
        const buffer = await fs.promises.readFile(r.path);
        const { url } = await uploadAsset(client, buffer, { filename: r.name, contentType: 'image/jpeg' });
        staged.push({ src: r.src, url });
      } catch (err) {
        staged.push({ src: r.src, url: r.src, error: err.message });
      }
      setProgress(job, 'Staging images', 35 + (done / imageResults.length) * 40);
      if (done % 5 === 0) persist(ctx, job);
    }
    persist(ctx, job);
  }

  setProgress(job, 'Writing products', 78);
  persist(ctx, job);

  const records = await syncProducts(client, result.products, staged, {
    skipDuplicates: !!job.skipDuplicates,
    onProgress(handle, action, i, total) {
      setProgress(job, `Writing ${handle}`, 78 + (i / total) * 20);
      if (i % 3 === 0 || i === total) persist(ctx, job);
    }
  });

  job.outcome = JSON.stringify(summarizeOutcome(records));
  job.status = records.some((r) => r.error) ? 'done-with-errors' : 'done';
  setProgress(job, 'Done', 100);
  persist(ctx, job);
  return job;
}

function persist(ctx, job) {
  ctx.db.prepare(
    `UPDATE imports SET stage = ?, progress = ?, status = ?, stats = ?, outcome = ?,
     rows_in = ?, products = ?, variants = ?, error = ?, finished_at = ?
     WHERE id = ?`
  ).run(
    job.stage, job.progress, job.status, job.stats, job.outcome,
    job.rows_in, job.products, job.variants, job.error,
    job.finished_at, job.id
  );
}

/**
 * Job registry. Jobs run one at a time on a single lane; new submissions are
 * queued rather than rejected so two merchants can submit back to back.
 */
function createImporter(ctx) {
  let lane = Promise.resolve();

  function startJob({ userId, filename, mode, input, processImages, skipDuplicates }) {
    const id = dbmod.newId('imp');

    let job;
    try {
      if (typeof input !== 'string' || !input.trim()) {
        throw new Error('Input is empty. Upload a CSV or JSON file with at least one row.');
      }
      if (input.length > MAX_FILE_BYTES) {
        throw new Error(`Input is larger than ${(MAX_FILE_BYTES / 1024 / 1024)} MB.`);
      }
      if (mode !== 'dry-run' && mode !== 'live') throw new Error(`Unknown mode "${mode}".`);
      const now = dbmod.nowIso();
      ctx.db.prepare(
        `INSERT INTO imports (id, user_id, filename, mode, status, stage, started_at, rows_in)
         VALUES (?, ?, ?, ?, 'queued', 'queued', ?, 0)`
      ).run(id, userId, filename || '', mode, now);

      job = {
        id,
        user_id: userId,
        filename: filename || '',
        mode,
        input,
        processImages: !!processImages,
        skipDuplicates: !!skipDuplicates,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        stats: '{}',
        outcome: '{}',
        error: '',
        rows_in: 0,
        products: 0,
        variants: 0,
        started_at: now,
        finished_at: ''
      };
    } catch (err) {
      // Validation failed before the row existed, so fail synchronously rather
      // than enqueueing a job that can never run.
      throw err;
    }

    lane = lane.then(() => runJob(ctx, job)).catch((err) => {
      job.status = 'failed';
      job.error = String(err.message || err);
      setProgress(job, 'Failed', 100);
      persist(ctx, job);
    });

    return id;
  }

  async function runJob(ctx, job) {
    const workDir = tempWorkDir(job.id);
    try {
      job.started_at = dbmod.nowIso();
      ctx.db.prepare('UPDATE imports SET status = ?, started_at = ? WHERE id = ?')
        .run('running', job.started_at, job.id);
      await executeJob(ctx, job, workDir);
    } finally {
      job.finished_at = dbmod.nowIso();
      persist(ctx, job);
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    }
  }

  function getJob(db, id) {
    const row = db.prepare('SELECT * FROM imports WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      filename: row.filename,
      mode: row.mode,
      status: row.status,
      stage: row.stage,
      progress: row.progress,
      stats: safeJson(row.stats),
      outcome: safeJson(row.outcome),
      error: row.error,
      rows_in: row.rows_in,
      products: row.products,
      variants: row.variants,
      started_at: row.started_at,
      finished_at: row.finished_at
    };
  }

  function listJobs(db, userId, limit = 50) {
    const rows = db.prepare(
      'SELECT id, user_id, filename, mode, status, stage, progress, stats, outcome, error, rows_in, products, variants, started_at, finished_at FROM imports WHERE user_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(userId, limit);
    return rows.map((r) => ({
      id: r.id, user_id: r.user_id, filename: r.filename, mode: r.mode, status: r.status,
      stage: r.stage, progress: r.progress, stats: safeJson(r.stats), outcome: safeJson(r.outcome),
      error: r.error, rows_in: r.rows_in, products: r.products, variants: r.variants,
      started_at: r.started_at, finished_at: r.finished_at
    }));
  }

  return { startJob, getJob, listJobs, executeJob, normalizePreview, testConnection };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}

module.exports = { createImporter, normalizePreview, testConnection, inputToRows, MAX_FILE_BYTES, API_VERSION };
