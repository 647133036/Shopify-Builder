#!/usr/bin/env node
'use strict';

/**
 * shopify-importer CLI
 *
 *   normalize   Map supplier rows to Shopify product + image CSVs
 *   fetch       Pull rows from a supplier API via config file
 *   images      Batch-process a folder of images to Shopify-friendly specs
 *   upload      Normalise then push to Shopify through the Admin API
 *   check       Validate input and show the field mapping without writing
 *   help        Show usage
 */

const fs = require('fs');
const path = require('path');

const HELP = `shopify-importer - import supplier product data into Shopify

Usage:
  shopify-importer <command> [options]

Commands:
  normalize   --input <csv|json>  --out <dir>   [--options Size,Colour,Fit]
               [--vendor X] [--process-images] [--images-dir images]
               [--max-dim 2048] [--quality 82] [--max-bytes 716800]
               [--no-deduplicate] [--no-link-handleless]
               Write Shopify-native products.csv, images.csv, manifest, report.
               --no-deduplicate keeps duplicate SKU rows; --no-link-handleless
               never merges handle-less rows into the previous product.

  fetch       --config <api.json> --out <dir>  [--max-pages 200]
               Pull rows from a supplier API. Writes rows.json plus a preview.

  images      --dir <in>           --out <dir>  [--max-dim 2048]
               [--quality 82] [--max-bytes 716800] [--fit cover|contain]
               [--box 2048x2048] [--keep-names]
               Batch-process images. Never upscales unless --fit is set.

  upload      --input <csv|json>   --shop <store.myshopify.com>
               --token <admin-token>  [--dry-run] [--stage-images]
               [--skip-images] [--skip-duplicates]
               [--max-dim 2048] [--quality 82] [--max-bytes 716800]
               Normalise and push products via the Admin API. --stage-images
               processes and uploads images to your own store CDN first.

  check       --input <csv|json>   [--options Size,Colour,Fit]
              Validate the input and print the detected field mapping.

Options:
  --help                  Show this help.
  --verbose               Extra progress output.

Examples:
  node bin/import.js check --input examples/products.csv
  node bin/import.js normalize --input examples/products.csv --out out
  node bin/import.js images --dir photos --out images
  node bin/import.js fetch --config examples/api-supplier.json --out out
  node bin/import.js upload --input out/products.csv --shop my.store --token TOKEN --dry-run

Environment:
  SHOPIFY_SHOP, SHOPIFY_TOKEN   used by upload if --shop/--token are omitted
  SHOPIFY_IMPORTER_VERBOSE=1    enables retry progress logging
`;

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--verbose') {
      args.verbose = true;
    } else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  args._ = positional;
  return args;
}

function requireOpt(args, name) {
  const v = args[name];
  if (!v) {
    throw new Error(`Missing required option --${name}. Run with --help for usage.`);
  }
  return v;
}

function csvOrJsonInput(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`);
  return file;
}

async function cmdCheck(args) {
  const file = csvOrJsonInput(requireOpt(args, 'input'));
  const { readInput } = require('../lib/run');
  const { normalize, PRODUCT_COLUMNS } = require('../lib/normalize');
  const options = args.options ? String(args.options).split(',').map((s) => s.trim()) : ['Size', 'Colour', 'Fit'];
  const rows = readInput(file);
  const result = normalize(rows, { optionNames: options });

  console.log(`Input rows : ${result.stats.inputRows}`);
  console.log(`Products   : ${result.stats.products}`);
  console.log(`Variants   : ${result.stats.variants}`);
  console.log(`Images     : ${result.stats.images}`);
  console.log(`Duplicates dropped   : ${result.stats.droppedDuplicates}`);
  console.log(`Malformed rows dropped: ${result.stats.droppedMalformed}`);
  console.log('');
  console.log('Field mapping (Shopify column <- source column)');
  console.log('-----------------------------------------------');
  for (const col of PRODUCT_COLUMNS) {
    const src = result.stats.fieldMap[col];
    if (src) console.log(`  ${col.padEnd(32)} <- ${src}`);
  }
  console.log('');
  if (result.errors.length) {
    console.log(`Warnings/errors (${result.errors.length})`);
    for (const e of result.errors.slice(0, 40)) console.log(`  line ${e.line}: ${e.code} ${e.message}`);
    if (result.errors.length > 40) console.log(`  ... and ${result.errors.length - 40} more`);
    console.log('');
  }
  const fatal = result.errors.filter((e) => e.code.startsWith('E_'));
  return { ok: fatal.length === 0, result };
}

async function cmdNormalize(args) {
  const file = csvOrJsonInput(requireOpt(args, 'input'));
  const { run } = require('../lib/run');
  const rows = readInputSafe(file);
  const options = args.options ? String(args.options).split(',').map((s) => s.trim()) : ['Size', 'Colour', 'Fit'];
  const r = await run(rows, {
    outDir: args.out || 'out',
    vendor: args.vendor || '',
    optionNames: options,
    processImages: !!args['process-images'],
    imagesDir: args['images-dir'] || 'images',
    maxDim: Number(args['max-dim'] || 2048),
    quality: Number(args.quality || 82),
    maxBytes: Number(args['max-bytes'] || 716800),
    deduplicateVariants: !args['no-deduplicate'],
    linkHandlelessRows: !args['no-link-handleless']
  });
  printResult(r, args);
  return r;
}

function readInputSafe(file) {
  const { readInput } = require('../lib/run');
  return readInput(file);
}

function printResult(r, args) {
  const s = r.result.stats;
  console.log('');
  console.log('Import normalised');
  console.log(`  rows in        : ${s.inputRows}`);
  console.log(`  products       : ${s.products}`);
  console.log(`  variants       : ${s.variants}`);
  console.log(`  images         : ${s.images}`);
  console.log(`  dupes dropped  : ${s.droppedDuplicates}`);
  console.log(`  malformed      : ${s.droppedMalformed}`);
  console.log('');
  console.log('Outputs');
  for (const f of r.written) console.log(`  ${path.relative(process.cwd(), f)}`);
  if (r.result.errors.length) {
    console.log('');
    console.log(`Warnings: ${r.result.errors.length} (see report.md)`);
  }
}

async function cmdFetch(args) {
  const configPath = requireOpt(args, 'config');
  if (!fs.existsSync(configPath)) throw new Error(`Config not found: ${configPath}`);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { fetchFromApi } = require('../lib/ingest/api');
  const outDir = args.out || 'out';
  await fs.promises.mkdir(outDir, { recursive: true });

  const { rows, pages } = await fetchFromApi(config, { maxPages: Number(args['max-pages'] || config.maxPages) });
  const file = path.join(outDir, 'rows.json');
  await fs.promises.writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`Fetched ${rows.length} rows over ${pages} request(s) -> ${file}`);
  if (rows.length) {
    console.log(`Sample fields: ${Object.keys(rows[0]).slice(0, 14).join(', ')}`);
    console.log('');
    console.log('Next step: shopify-importer normalize --input ' + file + ' --out out');
  }
  return { rows, pages };
}

async function cmdImages(args) {
  const dir = requireOpt(args, 'dir');
  const out = args.out || 'images';
  const { processImage } = require('../lib/media/process');
  const entries = await fs.promises.readdir(dir);
  const files = entries.filter((f) => !f.startsWith('.') && !fs.statSync(path.join(dir, f)).isDirectory());
  if (!files.length) throw new Error(`No files in ${dir}`);

  const fit = args.fit || null;
  const box = args.box ? parseBox(args.box) : null;
  const results = [];
  const used = new Set();
  const cache = new Map();

  for (const [i, name] of files.entries()) {
    process.stdout.write(`${String(i + 1).padStart(3)}/${files.length} ${name} `);
    try {
      const r = await processImage({
        src: path.join(dir, name),
        outDir: out,
        usedNames: used,
        dedupeCache: cache,
        maxDim: Number(args['max-dim'] || 2048),
        quality: Number(args.quality || 82),
        maxBytes: Number(args['max-bytes'] || 716800),
        fit: fit || undefined,
        box: box || undefined,
        name: args['keep-names'] ? name : undefined
      });
      console.log(
        `-> ${r.name} ${r.width}x${r.height} ${fmtBytes(r.originalBytes)} => ${fmtBytes(r.bytes)}${r.skipped ? ' (deduped)' : ''}`
      );
      results.push(r);
    } catch (err) {
      console.log(`ERROR ${err.message}`);
      results.push({ src: name, error: err.message });
    }
  }

  const reportFile = path.join(out, 'image-report.json');
  await fs.promises.writeFile(reportFile, JSON.stringify(results, null, 2), 'utf8');
  const failed = results.filter((r) => r.error).length;
  console.log('');
  console.log(`Processed ${results.length - failed}/${results.length} images -> ${out}`);
  if (failed) console.log(`Failed: ${failed} (see ${reportFile})`);
  return results;
}

function parseBox(spec) {
  const m = /^\s*(\d+)\s*[xX,]\s*(\d+)\s*$/.exec(spec);
  if (!m) throw new Error(`--box must look like 2048x2048, got "${spec}"`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

async function cmdUpload(args) {
  const shop = args.shop || process.env.SHOPIFY_SHOP;
  const token = args.token || process.env.SHOPIFY_TOKEN;
  if (!shop || !token) {
    throw new Error('upload needs --shop and --token (or SHOPIFY_SHOP / SHOPIFY_TOKEN env vars).');
  }

  const { Shopify } = require('../lib/shopify/client');
  const { syncProducts } = require('../lib/shopify/products');
  const { uploadAsset } = require('../lib/shopify/assets');
  const { processImage } = require('../lib/media/process');
  const { run, readInput } = require('../lib/run');

  const client = new Shopify({ shop, token });
  console.log('Verifying credentials...');
  const shopInfo = await client.whoami();
  console.log(`  authenticated as ${shopInfo.name || shopInfo.email || shop}`);

  const file = csvOrJsonInput(requireOpt(args, 'input'));
  const rows = readInput(file);
  const options = args.options ? String(args.options).split(',').map((s) => s.trim()) : ['Size', 'Colour', 'Fit'];
  const r = await run(rows, {
    outDir: args.out || 'out',
    optionNames: options,
    processImages: !!args['stage-images'],
    imagesDir: args['images-dir'] || 'images',
    maxDim: Number(args['max-dim'] || 2048),
    quality: Number(args.quality || 82),
    maxBytes: Number(args['max-bytes'] || 716800)
  });
  const { products } = r.result;

  const imageResults = [];
  if (args['stage-images'] && r.imageResults.length) {
    console.log(`\nStaging ${r.imageResults.length} image(s) on your own store...`);
    let n = 0;
    for (const img of r.imageResults) {
      if (img.error) continue;
      const buf = await fs.promises.readFile(img.path);
      try {
        const up = await uploadAsset(client, buf, { filename: img.name, contentType: 'image/jpeg' });
        img.url = up.url;
        n++;
        console.log(`  ${n}: ${img.name} -> ${up.url}`);
      } catch (err) {
        console.log(`  ! ${img.name}: ${err.message}`);
      }
    }
  }

  console.log(`\nSyncing ${products.length} variant row(s) to Shopify...`);
  const synced = await syncProducts(client, products, imageResults.length ? imageResults : [], {
    dryRun: !!args['dry-run'],
    skipImages: !!args['skip-images'],
    skipDuplicates: !!args['skip-duplicates']
  });

  const created = synced.filter((r) => r.action === 'created').length;
  const updated = synced.filter((r) => r.action === 'updated').length;
  const skipped = synced.filter((r) => r.action === 'skipped').length;
  const failed = synced.filter((r) => r.error).length;
  const dry = synced.filter((r) => r.action === 'dry-run').length;

  console.log('');
  if (dry) console.log(`Dry run: ${dry} product(s) staged, nothing sent.`);
  else {
    console.log(`  created : ${created}`);
    console.log(`  updated : ${updated}`);
    console.log(`  skipped : ${skipped}`);
    console.log(`  failed  : ${failed}`);
  }
  if (failed) {
    console.log('');
    console.log('Failures:');
    for (const r of synced.filter((x) => x.error).slice(0, 15)) {
      console.log(`  ${r.handle}: ${r.error}`);
    }
  }

  const logFile = path.join(args.out || 'out', 'upload-result.json');
  await fs.promises.writeFile(logFile, JSON.stringify(synced, null, 2), 'utf8');
  console.log(`\nDetail: ${path.relative(process.cwd(), logFile)}`);
  return { synced, failed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help && !args._[0]) {
    process.stdout.write(HELP);
    return;
  }
  const command = args._[0] || (args.help ? 'help' : null);
  if (!command || command === 'help') {
    process.stdout.write(HELP);
    return;
  }

  try {
    switch (command) {
      case 'check':
        await cmdCheck(args);
        break;
      case 'normalize':
        await cmdNormalize(args);
        break;
      case 'fetch':
        await cmdFetch(args);
        break;
      case 'images':
        await cmdImages(args);
        break;
      case 'upload':
        await cmdUpload(args);
        break;
      default:
        throw new Error(`Unknown command "${command}". Run with --help.`);
    }
  } catch (err) {
    console.error('');
    console.error('Error: ' + err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, HELP };
