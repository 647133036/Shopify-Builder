'use strict';

/**
 * Orchestrates one import run: ingest -> normalise -> optional image staging
 * -> write Shopify-native CSVs and a human-readable report.
 */

const fs = require('fs');
const path = require('path');
const { parseToObjects } = require('./csv');
const { normalize, PRODUCT_COLUMNS, IMAGE_COLUMNS } = require('./normalize');
const { stringify } = require('./csv');
const { processImage } = require('./media/process');

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function readInput(file, opts = {}) {
  const text = readText(file);
  if (/\.json$/i.test(file)) {
    const json = JSON.parse(text);
    return rowsFromAny(json);
  }
  if (/\.csv$/i.test(file) || file === '-') {
    return parseToObjects(text, { trim: opts.trim !== false });
  }
  throw new Error(`Unsupported input extension: ${file}. Use .csv or .json`);
}

/**
 * Accepts a JSON input shaped either as a bare array of rows, or as an object
 * with an array under a configured key path (supplier APIs commonly wrap
 * results in { data: { products: [...] } }).
 */
function rowsFromAny(json, opts = {}) {
  const itemsPath = opts.itemsPath;
  let items = itemsPath ? resolvePath(json, itemsPath) : json;
  if (!items) items = json;

  if (!Array.isArray(items)) {
    const found = firstArray(json);
    if (!found) throw new Error('JSON input does not contain an array of rows');
    items = found.value;
  }
  return items;
}

function resolvePath(obj, expr) {
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

function firstArray(obj, depth = 0) {
  if (Array.isArray(obj)) return { value: obj };
  if (typeof obj !== 'object' || obj === null || depth > 6) return null;
  for (const key of ['items', 'data', 'products', 'rows', 'result', 'records']) {
    if (Array.isArray(obj[key])) return { value: obj[key] };
  }
  for (const value of Object.values(obj)) {
    const hit = firstArray(value, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {Array<Object>} rows
 * @param {Object} opts   { optionNames, outDir, dryRun, vendor, ...normalizeOpts }
 * @returns {Promise<Object>} { result, written: [paths], stats, errors, images? }
 */
async function run(rows, opts = {}) {
  const o = Object.assign(
    {
      outDir: 'out',
      vendor: '',
      optionNames: ['Size', 'Colour', 'Fit'],
      processImages: false,
      imagesDir: 'images',
      skipDuplicates: false,
      imageDelimiters: /[,;\n|]+/,
      maxDim: 2048,
      quality: 82,
      maxBytes: 700 * 1024,
      deduplicateVariants: true,
      linkHandlelessRows: true
    },
    opts
  );

  const result = normalize(rows, {
    optionNames: o.optionNames,
    defaultVendor: o.vendor,
    deduplicateVariants: o.deduplicateVariants,
    linkHandlelessRows: o.linkHandlelessRows,
    imageDelimiters: o.imageDelimiters
  });

  const productsCsv = stringify(result.products, PRODUCT_COLUMNS);
  const imagesCsv = stringify(result.images, IMAGE_COLUMNS);

  const imageResults = [];
  if (o.processImages) {
    imageResults.push(...(await processImageSet(result.images, o)));
  }

  const written = [];
  await fs.promises.mkdir(o.outDir, { recursive: true });
  const p = path.join(o.outDir, 'products.csv');
  await fs.promises.writeFile(p, productsCsv, 'utf8');
  written.push(p);
  const i = path.join(o.outDir, 'images.csv');
  await fs.promises.writeFile(i, imagesCsv, 'utf8');
  written.push(i);

  if (imageResults.length) {
    const img = path.join(o.outDir, 'image-report.json');
    await fs.promises.writeFile(img, JSON.stringify(imageResults, null, 2), 'utf8');
    written.push(img);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    stats: result.stats,
    outputs: written,
    inputRows: result.stats.inputRows
  };
  const m = path.join(o.outDir, 'manifest.json');
  await fs.promises.writeFile(m, JSON.stringify(manifest, null, 2), 'utf8');
  written.push(m);

  const report = await writeReport(path.join(o.outDir, 'report.md'), result, imageResults);
  written.push(report);

  return { result, imageResults, written, manifest };
}

async function processImageSet(images, o) {
  const used = new Set();
  const cache = new Map();
  const results = [];
  for (const img of images) {
    const src = img.image_src || img.src;
    if (!src) continue;
    try {
      results.push(
        await processImage({
          src,
          outDir: o.imagesDir,
          usedNames: used,
          dedupeCache: cache,
          maxDim: o.maxDim,
          quality: o.quality,
          maxBytes: o.maxBytes
        })
      );
    } catch (err) {
      results.push({ src, error: err.message });
    }
  }
  return results;
}

async function writeReport(file, result, imageResults) {
  const lines = [];
  lines.push('# Import report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Input rows | ${result.stats.inputRows} |`);
  lines.push(`| Products | ${result.stats.products} |`);
  lines.push(`| Variants | ${result.stats.variants} |`);
  lines.push(`| Images | ${result.stats.images} |`);
  lines.push(`| Duplicates dropped | ${result.stats.droppedDuplicates} |`);
  lines.push(`| Malformed rows dropped | ${result.stats.droppedMalformed} |`);
  lines.push('');
  lines.push('## Field mapping');
  lines.push('');
  lines.push('| Shopify field | Source column |');
  lines.push('| --- | --- |');
  for (const [canonical, source] of Object.entries(result.stats.fieldMap)) {
    lines.push(`| ${canonical} | ${source} |`);
  }
  lines.push('');

  const errors = result.errors || [];
  lines.push(`## Warnings and errors (${errors.length})`);
  lines.push('');
  if (!errors.length) {
    lines.push('None.');
  } else {
    lines.push('| Line | Code | Message |');
    lines.push('| --- | --- | --- |');
    for (const e of errors.slice(0, 500)) {
      lines.push(`| ${e.line} | ${e.code} | ${String(e.message).replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');

  if (imageResults.length) {
    lines.push('## Image processing');
    lines.push('');
    lines.push('| File | Original | Output | Ratio |');
    lines.push('| --- | --- | --- | --- |');
    for (const r of imageResults.slice(0, 300)) {
      if (r.error) {
        lines.push(`| ${r.src} | - | ERROR: ${r.error} | - |`);
        continue;
      }
      const ratio = r.originalBytes ? Math.round((r.bytes / r.originalBytes) * 100) : 0;
      lines.push(`| ${r.name} | ${fmtBytes(r.originalBytes)} | ${fmtBytes(r.bytes)} | ${ratio}% |`);
    }
    lines.push('');
  }

  await fs.promises.writeFile(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

module.exports = { run, readInput, rowsFromAny, firstArray, writeReport };
