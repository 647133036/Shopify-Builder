#!/usr/bin/env node
'use strict';

/**
 * Local preview server for the importer.
 *
 * Serves the web UI and a small JSON API so you can drop a supplier CSV in,
 * see exactly what it would become, and download the Shopify-native files
 * before anything is sent to a store.
 *
 *   node bin/serve.js [--port 8080]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const UI_DIR = path.join(__dirname, '..', 'ui');

const HELP = `shopify-importer preview server

Usage: node bin/serve.js [--port 8080]

Endpoints:
  GET  /                 the web UI
  POST /api/normalize    multipart (file) or JSON {"csv": "..."} -> normalised result
  GET  /api/aliases      source column names recognised for each Shopify column
  GET  /api/health       liveness probe
`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i].startsWith('--port=')) args.port = Number(argv[i].slice(7));
  }
  return args;
}

/** Minimal multipart/form-data parser: returns { fields, files }. */
function parseMultipart(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buf.indexOf(delim);
  while (start !== -1) {
    start += delim.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    if (buf.slice(start, start + 2).toString() === '\r\n') start += 2;
    const end = buf.indexOf(delim, start);
    if (end === -1) break;
    parts.push(buf.slice(start, end - 2));
    start = end;
  }

  const fields = {};
  const files = [];
  for (const raw of parts) {
    const split = raw.indexOf('\r\n\r\n');
    if (split === -1) continue;
    const head = raw.slice(0, split).toString('utf8').split('\r\n');
    const body = raw.slice(split + 4);
    const header = {};
    for (const line of head) {
      const i = line.indexOf(':');
      if (i > 0) header[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const name = /name="([^"]*)"/.exec(header['content-disposition'] || '');
    if (!name) continue;
    const filename = /filename="([^"]*)"/.exec(header['content-disposition'] || '');
    if (filename) {
      files.push({ name: name[1], filename: filename[1], contentType: header['content-type'] || '', data: body });
    } else {
      fields[name[1]] = body.toString('utf8');
    }
  }
  return { fields, files };
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, code, body, contentType) {
  res.writeHead(code, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath.replace(/^\/ui\//, '/');
  const file = path.join(UI_DIR, path.normalize(rel));
  if (!file.startsWith(UI_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return sendText(res, 404, 'Not found');
  }
  const ext = path.extname(file).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}

async function handleNormalize(res, req) {
  const { parseToObjects, stringify } = require('../lib/csv');
  const { normalize, FIELD_ALIASES, PRODUCT_COLUMNS, IMAGE_COLUMNS } = require('../lib/normalize');
  const { rowsFromAny } = require('../lib/run');

  let text = '';
  let filename = 'input.csv';

  if (req.headers['content-type'] && /multipart/i.test(req.headers['content-type'])) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type']);
    if (!m) return sendJson(res, 400, { error: 'multipart request without a boundary' });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    const { fields, files } = parseMultipart(buf, (m[1] || m[2]).trim());
    const file = files[0];
    if (!file) return sendJson(res, 400, { error: 'no file uploaded. Send a form field containing the CSV/JSON.' });
    filename = file.filename || 'input.csv';
    text = file.data.toString('utf8');
  } else {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    try {
      const obj = JSON.parse(raw);
      text = obj.csv || obj.text || obj;
      if (obj.filename) filename = obj.filename;
    } catch (err) {
      text = raw;
    }
  }

  if (!text || !String(text).trim()) return sendJson(res, 400, { error: 'empty input' });

  let rows;
  try {
    const looksJson = /\.json$/i.test(filename) || /^\s*[[{]/.test(String(text));
    if (looksJson) {
      rows = rowsFromAny(JSON.parse(String(text)));
    } else {
      rows = parseToObjects(String(text), { trim: true });
    }
  } catch (err) {
    return sendJson(res, 400, { error: `Could not read the input as CSV or JSON: ${err.message}` });
  }

  const result = normalize(rows, { optionNames: ['Size', 'Colour', 'Fit'] });

  return sendJson(res, 200, {
    filename,
    stats: result.stats,
    errors: result.errors,
    products: result.products,
    images: result.images,
    productsCsv: stringify(result.products, PRODUCT_COLUMNS),
    imagesCsv: stringify(result.images, IMAGE_COLUMNS),
    columns: PRODUCT_COLUMNS,
    aliases: FIELD_ALIASES
  });
}

function handleDemo(res) {
  const { parseToObjects, stringify } = require('../lib/csv');
  const { normalize, FIELD_ALIASES, PRODUCT_COLUMNS, IMAGE_COLUMNS } = require('../lib/normalize');
  const { rowsFromAny } = require('../lib/run');

  const demoFile = path.join(UI_DIR, '..', 'examples', 'products.csv');
  if (!fs.existsSync(demoFile)) return sendJson(res, 404, { error: 'bundled sample not found' });

  const rows = parseToObjects(fs.readFileSync(demoFile, 'utf8'), { trim: true });
  const result = normalize(rows, { optionNames: ['Size', 'Colour', 'Fit'] });

  return sendJson(res, 200, {
    filename: 'examples/products.csv',
    stats: result.stats,
    errors: result.errors,
    products: result.products,
    images: result.images,
    productsCsv: stringify(result.products, PRODUCT_COLUMNS),
    imagesCsv: stringify(result.images, IMAGE_COLUMNS),
    columns: PRODUCT_COLUMNS,
    aliases: FIELD_ALIASES
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const port = Number(args.port || process.env.PORT || 8080);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/aliases') {
        return sendJson(res, 200, require('../lib/normalize').FIELD_ALIASES);
      }
      if (req.method === 'GET' && url.pathname === '/api/demo') {
        return handleDemo(res);
      }
      if (req.method === 'POST' && url.pathname === '/api/normalize') {
        return await handleNormalize(res, req);
      }
      if (req.method === 'GET') return serveStatic(res, url.pathname);
      return sendText(res, 405, 'Method not allowed');
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  });

  server.listen(port, () => {
    console.log(`Preview UI on http://localhost:${port}`);
    console.log('Drop a supplier CSV or JSON in the UI, or POST to /api/normalize.');
  });
}

if (require.main === module) main();

module.exports = { parseMultipart, main };
