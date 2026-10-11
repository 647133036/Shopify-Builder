'use strict';

/**
 * Image pipeline: fetch (local path or https URL) -> optionally crop/fit ->
 * compress to a byte budget -> write to the output folder.
 *
 * Never upscales. Supplier photos arrive at all sorts of resolutions and
 * blowing them up to 2048px only bloats the file and blurs the product.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

let sharp = null;
function getSharp() {
  if (!sharp) {
    try {
      sharp = require('sharp');
    } catch (err) {
      throw new Error(
        "sharp is not installed. Run `npm install -g sharp` then re-run with NODE_PATH=$(npm root -g), or install locally with `npm install sharp`."
      );
    }
  }
  return sharp;
}

const DEFAULTS = {
  maxDim: 2048,
  fit: null,
  box: null,
  quality: 82,
  minQuality: 55,
  maxBytes: 700 * 1024,
  format: 'jpeg',
  background: { r: 255, g: 255, b: 255 },
  timeoutMs: 30000,
  maxDownloadBytes: 25 * 1024 * 1024,
  allowSmaller: true
};

function readImage(input) {
  return fs.promises.readFile(input);
}

function download(url, opts) {
  const o = Object.assign({ timeoutMs: DEFAULTS.timeoutMs, maxBytes: DEFAULTS.maxDownloadBytes }, opts || {});
  const lib = url.startsWith('http:') ? http : https;

  return new Promise((resolve, reject) => {
    const req = lib.get(url, { timeout: o.timeoutMs, headers: { 'User-Agent': 'ShopifyImporter/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), o));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > o.maxBytes) {
          req.destroy();
          return reject(new Error(`Download too large (> ${o.maxBytes} bytes): ${url}`));
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Download timed out after ${o.timeoutMs}ms: ${url}`));
    });
    req.on('error', reject);
  });
}

async function acquire(src) {
  if (/^https?:\/\//i.test(src)) return download(src);
  return readImage(src);
}

function basenameFor(src, used) {
  let name;
  if (/^https?:\/\//i.test(src)) {
    try {
      const p = new URL(src).pathname;
      name = path.basename(p).replace(/\?[^?]*$/, '');
    } catch (err) {
      name = 'image';
    }
  } else {
    name = path.basename(src);
  }
  const ext = path.extname(name) || '.jpg';
  const stem = path.basename(name, ext).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';

  const candidate = (i) => (i === 0 ? `${stem}.jpg` : `${stem}-${i}.jpg`);
  let n = 0;
  while (used.has(candidate(n))) n++;
  used.add(candidate(n));
  return candidate(n);
}

/**
 * @param {Object} params
 *   src          local path or http(s) URL
 *   outDir       folder to write processed files into
 *   usedNames    Set of filenames already taken (mutated)
 *   dedupeCache  Map<sha256, {name, width, height, bytes}> (mutated)
 *   ...DEFAULTS
 * @returns {Promise<Object>} { name, path, width, height, bytes, originalBytes, skipped }
 */
async function processImage(params) {
  const o = Object.assign({}, DEFAULTS, params);
  const S = getSharp();

  const buf = await acquire(o.src);
  const originalBytes = buf.length;

  const digest = crypto.createHash('sha256').update(buf).digest('hex');
  if (o.dedupeCache && o.dedupeCache.has(digest)) {
    const hit = o.dedupeCache.get(digest);
    return Object.assign({ src: o.src, originalBytes }, hit, { skipped: true });
  }

  const meta = await S(buf).metadata();
  const width = meta.width;
  const height = meta.height;

  if (!width || !height) throw new Error(`No image dimensions for ${o.src}`);

  const needsDownscale = width > o.maxDim || height > o.maxDim;
  const scale = needsDownscale ? o.maxDim / Math.max(width, height) : 1;

  // Rebuilt from source on every pass so geometry stays intact while quality
  // drops until the file fits the byte budget.
  function build() {
    let p = S(buf);
    if (o.fit && o.box) {
      p = p.resize(o.box.width, o.box.height, { fit: o.fit, background: o.background });
    } else if (needsDownscale) {
      p = p.resize(Math.round(width * scale), Math.round(height * scale), { fit: 'fill', kernel: 'lanczos3' });
    }
    return p;
  }

  // Recompress loop: rebuild from source each pass so geometry stays intact
  // while quality drops until the file fits the byte budget.
  let out = null;
  let pass = o.quality;
  while (pass >= o.minQuality) {
    out = await build().jpeg({ quality: pass, progressive: true, mozjpeg: true }).toBuffer();
    if (out.length <= o.maxBytes) break;
    pass -= 5;
  }

  const finalMeta = await S(out).metadata();
  const name = o.name || basenameFor(o.src, o.usedNames || new Set());
  const outDir = o.outDir || 'images';
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, name);
  await fs.promises.writeFile(outPath, out);

  const result = {
    src: o.src,
    name,
    path: outPath,
    relativePath: path.relative(process.cwd(), outPath),
    width: finalMeta.width,
    height: finalMeta.height,
    bytes: out.length,
    originalBytes,
    quality: pass,
    skipped: false
  };

  if (o.usedNames) o.usedNames.add(name);
  if (o.dedupeCache) o.dedupeCache.set(digest, result);

  return result;
}

module.exports = { processImage, download, DEFAULTS, acquire };
