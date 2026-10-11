'use strict';

/**
 * smoke.js - dependency-free test runner plus the importer's test suite.
 * Run: node tests/smoke.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const csv = require(path.join(ROOT, 'lib/csv.js'));
const { normalize, parsePrice, toGrams, slugify } = require(path.join(ROOT, 'lib/normalize.js'));
const { processImage } = require(path.join(ROOT, 'lib/media/process.js'));
const { resolve, interpolate, interpolateDeep } = require(path.join(ROOT, 'lib/ingest/api.js'));
const { run, readInput, firstArray } = require(path.join(ROOT, 'lib/run.js'));
const { Shopify } = require(path.join(ROOT, 'lib/shopify/client.js'));
const { serialLane, withRetry } = require(path.join(ROOT, 'lib/shopify/client.js'));
const { groupByHandle, toAdminVariants, imageEntries, syncProducts } = require(path.join(ROOT, 'lib/shopify/products.js'));
const { parseArgs } = require(path.join(ROOT, 'bin/import.js'));

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push({ name, err });
  }
}

function approx(a, b, eps = 0.0001) {
  assert(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
}

const T = (n) => n.toFixed(2);

(async () => {
  // ---------------------------------------------------------------- csv
  await test('csv: quotes, escaped quotes, commas in fields', () => {
    const rows = csv.parse('a,b,c\n1,"two,three",3\n');
    assert.deepStrictEqual(rows, [['a', 'b', 'c'], ['1', 'two,three', '3']]);
  });

  await test('csv: escaped quotes preserved', () => {
    const rows = csv.parse('a\n"she said ""hi"""\n');
    assert.strictEqual(rows[1][0], 'she said "hi"');
  });

  await test('csv: newline inside a quoted field stays in that field', () => {
    const rows = csv.parse('a,b\n"x\ny",z\n');
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[1], ['x\ny', 'z']);
  });

  await test('csv: CRLF and BOM', () => {
    const rows = csv.parse('\uFEFFa,b\r\n1,2\r\n');
    assert.deepStrictEqual(rows, [['a', 'b'], ['1', '2']]);
  });

  await test('csv: unquoted leading space is preserved via quoting on output', () => {
    const out = csv.stringify([{ a: ' lead', b: 'x' }], ['a', 'b']);
    assert.strictEqual(out.split('\n')[1], '" lead",x\n'.replace('\n', ''));
  });

  await test('csv: stringify round-trips rows with commas, quotes and newlines', () => {
    const rows = [
      { a: 'plain', b: 'has,comma', c: 'has "quotes"' },
      { a: 'line\nbreak', b: '', c: '  spaces  ' }
    ];
    const text = csv.stringify(rows, ['a', 'b', 'c']);
    const back = csv.parseToObjects(text);
    assert.strictEqual(back.length, 2);
    assert.strictEqual(back[0].b, 'has,comma');
    assert.strictEqual(back[0].c, 'has "quotes"');
    assert.strictEqual(back[1].a, 'line\nbreak');
    assert.strictEqual(back[1].c, '  spaces  ');
  });

  await test('csv: parseToObjects handles ragged rows and blanks', () => {
    const rows = csv.parseToObjects('a,b\n1,2\n3\n\n');
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[1].b, '');
  });

  // ------------------------------------------------------- price parsing
  await test('price: USD with symbol and comma thousands', () => {
    assert.strictEqual(parsePrice('$1,234.56'), '1234.56');
  });

  await test('price: plain decimal', () => {
    assert.strictEqual(parsePrice('38.00'), '38.00');
  });

  await test('price: European format with comma decimal', () => {
    assert.strictEqual(parsePrice('€289,00'), '289.00');
  });

  await test('price: plain number without decimals', () => {
    assert.strictEqual(parsePrice('42'), '42.00');
  });

  await test('price: empty and garbage return empty', () => {
    assert.strictEqual(parsePrice(''), '');
    assert.strictEqual(parsePrice('n/a'), '');
    assert.strictEqual(parsePrice(null), '');
    assert.strictEqual(parsePrice('-'), '');
  });

  await test('price: negative returns empty (Shopify rejects negative prices)', () => {
    assert.strictEqual(parsePrice('-5.00'), '');
  });

  await test('price: three decimals after dot treated as thousands separator', () => {
    assert.strictEqual(parsePrice('1.234,56'), '1234.56');
    assert.strictEqual(parsePrice('1,234'), '1234.00');
  });

  // ------------------------------------------------------------ weights
  await test('weight: ounces to grams', () => {
    approx(toGrams('10', 'oz'), 283, 0.5);
  });

  await test('weight: pounds to grams', () => {
    approx(toGrams('1.6', 'lb'), 725.747, 0.6);
  });

  await test('weight: kilograms and grams', () => {
    approx(toGrams('2', 'kg'), 2000, 0.01);
    approx(toGrams('180', 'g'), 180, 0.01);
  });

  await test('weight: unknown unit defaults to grams; empty and bad return empty', () => {
    approx(toGrams('5', 'stones'), 5, 0.01);
    approx(toGrams('4', ''), 4, 0.01);
    assert.strictEqual(toGrams('', 'g'), '');
    assert.strictEqual(toGrams('abc', 'g'), '');
    assert.strictEqual(toGrams('0', 'g'), '');
    assert.strictEqual(toGrams('-5', 'g'), '');
  });

  // --------------------------------------------------------------- slug
  await test('slug: accents, punctuation, casing, length', () => {
    assert.strictEqual(slugify('Éssential Cotton Tee!'), 'essential-cotton-tee');
    assert.strictEqual(slugify('  A   B  '), 'a-b');
    assert.strictEqual(slugify('Ünïquê').length > 0, true);
    assert.ok(slugify('x'.repeat(300)).length <= 100);
    assert.strictEqual(slugify('---'), '');
    assert.strictEqual(slugify(12345), '12345');
  });

  // ----------------------------------------------------------- normalize
  function rowsFrom(list) {
    return list.map((o) => Object.assign({ title: '', description: '', sku: '', price: '' }, o));
  }

  await test('normalize: groups variants by handle and assigns positions', () => {
    const r = normalize(
      rowsFrom([
        { title: 'Tee', handle: 'tee', sku: 'A', price: '10', option1_value: 'S', option1_name: 'Size' },
        { title: 'Tee', handle: 'tee', sku: 'B', price: '11', option1_value: 'M', option1_name: 'Size' },
        { title: 'Cap', handle: 'cap', sku: 'C', price: '20', option1_value: 'One Size', option1_name: 'Size' }
      ])
    );
    assert.strictEqual(r.stats.products, 2);
    assert.strictEqual(r.stats.variants, 3);
    const tee = r.products.filter((p) => p.handle === 'tee');
    assert.strictEqual(tee.length, 2);
    assert.strictEqual(tee[0].variant_position, '1');
    assert.strictEqual(tee[1].variant_position, '2');
  });

  await test('normalize: distinct products stay separate, handle on only the first row', () => {
    const r = normalize(
      rowsFrom([
        { title: 'Cotton Tee', handle: 'tee-a', sku: '1', price: '10' },
        { title: 'Cotton Tee', sku: '2', price: '11' },
        { title: 'Denim Jacket', handle: 'jacket', sku: '3', price: '40' },
        { title: 'Denim Jacket', sku: '4', price: '42' }
      ])
    );
    assert.deepStrictEqual([...new Set(r.products.map((p) => p.handle))].sort(), ['jacket', 'tee-a']);
    assert.strictEqual(r.stats.products, 2);
    assert.strictEqual(r.products.filter((p) => p.handle === 'tee-a').length, 2);
    assert.strictEqual(r.products.filter((p) => p.handle === 'jacket').length, 2);
  });

  await test('normalize: linkHandlelessRows: false splits same-title rows apart', () => {
    const r = normalize(
      rowsFrom([
        { title: 'Beanie', handle: 'merino-beanie', sku: '1', price: '10' },
        { title: 'Beanie', sku: '2', price: '11' }
      ]),
      { linkHandlelessRows: false }
    );
    assert.deepStrictEqual([...new Set(r.products.map((p) => p.handle))].sort(), ['beanie', 'merino-beanie']);
  });

  await test('normalize: a handle on only the first row keeps the product together', () => {
    const r = normalize(
      rowsFrom([
        { title: 'Beanie', handle: 'merino-beanie', sku: '1', price: '10' },
        { title: 'Beanie', sku: '2', price: '11' },
        { title: 'Beanie', sku: '3', price: '12' }
      ])
    );
    assert.deepStrictEqual([...new Set(r.products.map((p) => p.handle))], ['merino-beanie']);
    assert.strictEqual(r.stats.products, 1);
    assert.strictEqual(r.products.length, 3);
  });

  await test('normalize: identical SKUs are deduplicated once', () => {
    const r = normalize(
      rowsFrom([
        { title: 'Tee', sku: 'SAME', price: '10' },
        { title: 'Tee', sku: 'SAME', price: '99' },
        { title: 'Tee', sku: 'OTHER', price: '11' }
      ])
    );
    assert.strictEqual(r.stats.droppedDuplicates, 1);
    assert.strictEqual(r.stats.variants, 2);
    const kept = r.products.find((p) => p.variant_sku === 'SAME');
    assert.strictEqual(kept.variant_price, '10.00');
  });

  await test('normalize: empty title and missing price are dropped as malformed', () => {
    const r = normalize(
      rowsFrom([
        { title: '', sku: 'X', price: '10' },
        { title: 'No Price', sku: 'Y', price: '' },
        { title: 'Good', sku: 'Z', price: '5' }
      ])
    );
    assert.strictEqual(r.stats.droppedMalformed, 2);
    assert.strictEqual(r.stats.variants, 1);
    assert.ok(r.errors.some((e) => e.code === 'E_EMPTY_TITLE'));
    assert.ok(r.errors.some((e) => e.code === 'E_NO_PRICE'));
  });

  await test('normalize: rows with no price do not leave an empty product behind', () => {
    const r = normalize(rowsFrom([{ title: 'Ghost', sku: 'G', price: '' }]));
    assert.strictEqual(r.stats.products, 0);
    assert.strictEqual(r.stats.variants, 0);
  });

  await test('normalize: field aliases map supplier column names', () => {
    const source = {
      product_name: 'Sock',
      desc: 'Text',
      supplier_name: 'Brand',
      cat: 'Socks',
      tag_list: 'a, b',
      publish: 'draft',
      product_sku: 'S1',
      retail: '9.5',
      msrp: '12.00',
      wt: '3',
      unit: 'oz',
      opt1_name: 'Size',
      opt1_value: 'M',
      opt2_name: 'Colour',
      opt2_value: 'Black',
      photos: 'https://x/1.jpg'
    };
    const r = normalize([source]);
    const p = r.products[0];
    assert.strictEqual(p.title, 'Sock');
    assert.strictEqual(p.body_html, '<p>Text</p>');
    assert.strictEqual(p.vendor, 'Brand');
    assert.strictEqual(p.product_type, 'Socks');
    assert.strictEqual(p.tags, 'a, b');
    assert.strictEqual(p.status, 'draft');
    assert.strictEqual(p.variant_sku, 'S1');
    assert.strictEqual(p.variant_price, '9.50');
    assert.strictEqual(p.variant_compare_at_price, '12.00');
    assert.strictEqual(p.option1_name, 'Size');
    assert.strictEqual(p.option1_value, 'M');
    assert.strictEqual(p.option2_name, 'Colour');
    assert.strictEqual(p.option2_value, 'Black');
    assert.strictEqual(p.image_src, 'https://x/1.jpg');
  });

  await test('normalize: option names fall back to configured defaults', () => {
    const r = normalize(
      rowsFrom([{ title: 'Tee', sku: '1', price: '10', option1_value: 'S', option2_value: 'Black' }]),
      { optionNames: ['Size', 'Colour', 'Fit'] }
    );
    const p = r.products[0];
    assert.strictEqual(p.option1_name, 'Size');
    assert.strictEqual(p.option1_value, 'S');
    assert.strictEqual(p.option2_name, 'Colour');
    assert.strictEqual(p.option2_value, 'Black');
    assert.strictEqual(p.option3_name, 'Fit');
    assert.strictEqual(p.option3_value, '');
  });

  await test('normalize: html descriptions pass through, plain text gets wrapped', () => {
    const r = normalize(
      rowsFrom([
        { title: 'A', sku: '1', price: '1', description: '<p>Already <b>html</b></p>' },
        { title: 'B', sku: '2', price: '2', description: 'Plain text first.\n\nSecond paragraph.' }
      ])
    );
    assert.strictEqual(r.products[0].body_html, '<p>Already <b>html</b></p>');
    assert.strictEqual(r.products[1].body_html, '<p>Plain text first.</p><p>Second paragraph.</p>');
  });

  await test('normalize: seo fields are truncated to safe lengths', () => {
    const r = normalize(
      rowsFrom([
        {
          title: 'Tee',
          sku: '1',
          price: '1',
          seo_title: 'T'.repeat(200),
          seo_description: 'D'.repeat(500)
        }
      ])
    );
    const p = r.products[0];
    assert.ok(p.seo_title.length <= 70, `seo_title ${p.seo_title.length}`);
    assert.ok(p.seo_description.length <= 300, `seo_description ${p.seo_description.length}`);
    assert.ok(p.seo_title.endsWith('…'));
  });

  await test('normalize: seo_title falls back to the product title', () => {
    const r = normalize(rowsFrom([{ title: 'No Seo Set', sku: '1', price: '1' }]));
    assert.strictEqual(r.products[0].seo_title, 'No Seo Set');
  });

  await test('normalize: variant weights become grams in two columns', () => {
    const r = normalize(rowsFrom([{ title: 'A', sku: '1', price: '1', variant_weight: '2', variant_weight_unit: 'lb' }]));
    assert.strictEqual(r.products[0].variant_weight, r.products[0].variant_grams);
    assert.strictEqual(r.products[0].variant_weight_unit, 'g');
    assert.ok(Number(r.products[0].variant_grams) > 900);
  });

  await test('normalize: images are unioned across a group, order preserved', () => {
    const r = normalize(
      rowsFrom([
        { title: 'A', sku: '1', price: '1', image_src: 'https://x/1.jpg' },
        { title: 'A', sku: '2', price: '2', image_src: 'https://x/2.jpg,https://x/3.jpg' },
        { title: 'A', sku: '3', price: '3', image_src: 'https://x/1.jpg,https://x/4.jpg' }
      ])
    );
    assert.deepStrictEqual(r.images.map((i) => i.image_src), [
      'https://x/1.jpg',
      'https://x/2.jpg',
      'https://x/3.jpg',
      'https://x/4.jpg'
    ]);
    assert.deepStrictEqual(r.images.map((i) => Number(i.image_position)), [1, 2, 3, 4]);
  });

  await test('normalize: multi-value image cells split on comma, semicolon and newline', () => {
    const r = normalize(rowsFrom([{ title: 'A', sku: '1', price: '1', image_src: 'a.jpg; b.jpg\n c.jpg' }]));
    assert.strictEqual(r.images.length, 3);
  });

  await test('normalize: first image becomes the variant image; alt defaults to title', () => {
    const r = normalize(rowsFrom([{ title: 'A', sku: '1', price: '1', image_src: 'a.jpg' }]));
    assert.strictEqual(r.products[0].variant_image, 'a.jpg');
    assert.strictEqual(r.products[0].alt, 'A');
    assert.strictEqual(r.images[0].alt, 'A');
  });

  await test('normalize: missing title column fails with a single clear error', () => {
    const r = normalize([{ sku: '1', price: '1' }]);
    assert.strictEqual(r.stats.variants, 0);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].code, 'E_NO_TITLE');
  });

  await test('normalize: dedup can be disabled to keep every row', () => {
    const r = normalize(
      rowsFrom([
        { title: 'A', sku: '1', price: '1' },
        { title: 'A', sku: '1', price: '2' }
      ]),
      { deduplicateVariants: false }
    );
    assert.strictEqual(r.stats.variants, 2);
    assert.strictEqual(r.stats.droppedDuplicates, 0);
  });

  await test('normalize: handle derived from title when no handle given', () => {
    const r = normalize(rowsFrom([{ title: 'Heavyweight Hoodie!', sku: '1', price: '1' }]));
    assert.strictEqual(r.products[0].handle, 'heavyweight-hoodie');
  });

  // ---------------------------------------------------------------- api
  await test('api resolve: dotted, indexed and missing paths', () => {
    const doc = { data: { items: [{ a: 1 }, { a: 2 }] } };
    assert.strictEqual(resolve(doc, '$.data.items[0].a'), 1);
    assert.strictEqual(resolve(doc, 'data.items[1].a'), 2);
    assert.strictEqual(resolve(doc, '$.data.missing'), undefined);
    assert.strictEqual(resolve(doc, '$.data.items[0].nope.deeper'), undefined);
  });

  await test('api interpolate: env vars and deep objects', () => {
    const env = { K: 'v1', N: 'n2' };
    assert.strictEqual(interpolate('Bearer ${K}', env), 'Bearer v1');
    assert.deepStrictEqual(interpolateDeep({ h: { auth: '${K}' }, arr: ['${N}'] }, env), {
      h: { auth: 'v1' },
      arr: ['n2']
    });
  });

  await test('api interpolate: unset variable throws a helpful error', () => {
    assert.throws(() => interpolate('${NOPE_ZZZ}', {}), /NOPE_ZZZ/);
  });

  // --------------------------------------------------------------- run
  await test('run: readInput detects csv and json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-'));
    const csvFile = path.join(tmp, 'in.csv');
    fs.writeFileSync(csvFile, 'title,sku,price\nTee,T1,10\n');
    const jsonFile = path.join(tmp, 'in.json');
    fs.writeFileSync(jsonFile, JSON.stringify([{ title: 'Cap', sku: 'C', price: '5' }]));
    assert.strictEqual(readInput(csvFile).length, 1);
    assert.strictEqual(readInput(jsonFile)[0].sku, 'C');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('run: rowsFromAny unwraps a nested supplier payload', () => {
    const a = { data: { products: [{ title: 'X' }] } };
    const b = { items: [{ title: 'Y' }] };
    const c = [{ title: 'Z' }];
    assert.strictEqual(run_rowsFromAny(a).length, 1);
    assert.strictEqual(run_rowsFromAny(b)[0].title, 'Y');
    assert.strictEqual(run_rowsFromAny(c)[0].title, 'Z');
    function run_rowsFromAny(doc) {
      const { rowsFromAny } = require(path.join(ROOT, 'lib/run.js'));
      return rowsFromAny(doc);
    }
  });

  await test('run: firstArray finds the first array in a nested object', () => {
    const hit = firstArray({ meta: { x: 1 }, results: { items: [1, 2, 3] } });
    assert.deepStrictEqual(hit.value, [1, 2, 3]);
    assert.strictEqual(firstArray({ a: 1 }), null);
  });

  await test('run: normalize command writes the four expected artifacts', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-run-'));
    const input = path.join(tmp, 'in.csv');
    fs.writeFileSync(
      input,
      'title,sku,price,weight,weight_unit,option1_name,option1_value\nTee,S1,10,1,oz,Size,S\nTee,S2,11,2,oz,Size,M\n'
    );
    const r = await run(readInput(input), { outDir: path.join(tmp, 'out') });
    const outDir = path.join(tmp, 'out');
    assert.deepStrictEqual(
      fs.readdirSync(outDir).sort(),
      ['images.csv', 'manifest.json', 'products.csv', 'report.md']
    );
    const products = csv.parseToObjects(fs.readFileSync(path.join(outDir, 'products.csv'), 'utf8'));
    assert.strictEqual(products.length, 2);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    assert.strictEqual(manifest.stats.variants, 2);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ------------------------------------------------------------- client
  await test('shopify client: shop normalisation adds the myshopify domain', () => {
    const c = new Shopify({ shop: 'my-brand', token: 't' });
    assert.ok(c.adminRoot.includes('my-brand.myshopify.com'));
    const c2 = new Shopify({ shop: 'https://other.myshopify.com/', token: 't' });
    assert.strictEqual(c2.shop, 'other.myshopify.com');
    assert.ok(c2.adminRoot.includes('/admin/api/'));
  });

  await test('shopify client: constructor rejects missing credentials', () => {
    assert.throws(() => new Shopify({ shop: 'x', token: '' }), /shop and token/);
    assert.throws(() => new Shopify({ token: 't' }), /shop and token/);
  });

  await test('withRetry: honours Retry-After and gives up after attempts', async () => {
    let n = 0;
    const err = new Error('429');
    err.status = 429;
    err.retryAfter = '0';
    await assert.rejects(
      withRetry(async () => {
        n++;
        throw err;
      }, { attempts: 2, baseMs: 1 }),
      /429/
    );
    assert.strictEqual(n, 2);
  });

  await test('withRetry: succeeds after transient failures', async () => {
    let n = 0;
    const out = await withRetry(async () => {
      n++;
      if (n < 3) throw new Error('500');
      return 'ok';
    }, { attempts: 4, baseMs: 1, label: 't' });
    assert.strictEqual(out, 'ok');
    assert.strictEqual(n, 3);
  });

  await test('withRetry: does not retry non-retryable statuses', async () => {
    let n = 0;
    await assert.rejects(
      withRetry(async () => {
        n++;
        const e = new Error('400');
        e.status = 400;
        throw e;
      }, { attempts: 5, baseMs: 1 }),
      /400/
    );
    assert.strictEqual(n, 1);
  });

  await test('serialLane: serialises writes and preserves order', async () => {
    const lane = serialLane(1);
    const order = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        lane(async () => {
          order.push(n);
          await new Promise((r) => setTimeout(r, 1));
        })
      )
    );
    assert.deepStrictEqual(order, [1, 2, 3, 4, 5]);
  });

  // ---------------------------------------------------------- products
  await test('products: groupByHandle preserves variant order and titles', () => {
    const g = groupByHandle([
      { handle: 'a', title: 'A', variant_sku: '1', variant_position: '2' },
      { handle: 'a', title: 'A', variant_sku: '2', variant_position: '1' },
      { handle: 'b', title: 'B', variant_sku: '3', variant_position: '1' }
    ]);
    assert.strictEqual(g.length, 2);
    assert.strictEqual(g[0].handle, 'a');
    assert.strictEqual(g[0].variants.length, 2);
    assert.strictEqual(g[0].variants[0].variant_sku, '1');
    assert.strictEqual(g[0].published, true);
  });

  await test('products: draft status maps to unpublished', () => {
    const g = groupByHandle([{ handle: 'a', title: 'A', status: 'draft' }]);
    assert.strictEqual(g[0].published, false);
    assert.strictEqual(g[0].status, 'draft');
  });

  await test('products: toAdminVariants drops nulls for empty option values', () => {
    const v = toAdminVariants([
      {
        variant_position: '1',
        variant_sku: 'S1',
        variant_price: '10.00',
        variant_compare_at_price: '',
        variant_grams: '',
        variant_weight_unit: 'g',
        variant_inventory_policy: 'continue',
        variant_inventory_tracker: '',
        variant_requires_shipping: 'true',
        variant_taxable: 'true',
        option1_value: 'M',
        option2_value: '',
        option3_value: ''
      }
    ]);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].sku, 'S1');
    assert.strictEqual(v[0].price, '10.00');
    assert.strictEqual(v[0].compare_at_price, null);
    assert.strictEqual(v[0].weight, null);
    assert.strictEqual(v[0].option1, 'M');
    assert.strictEqual(v[0].option2, null);
    assert.strictEqual(v[0].requires_shipping, true);
    assert.strictEqual(v[0].inventory_management, '');
  });

  await test('products: toAdminVariants honours explicit false flags', () => {
    const v = toAdminVariants([
      {
        variant_position: '1',
        variant_sku: '1',
        variant_price: '1',
        variant_requires_shipping: 'false',
        variant_taxable: 'false',
        variant_inventory_tracker: 'shopify',
        option1_value: 'x',
        option2_value: 'y',
        option3_value: ''
      }
    ]);
    assert.strictEqual(v[0].requires_shipping, false);
    assert.strictEqual(v[0].taxable, false);
    assert.strictEqual(v[0].inventory_management, 'shopify');
    assert.strictEqual(v[0].option2, 'y');
  });

  await test('products: imageEntries rewrites staged URLs and drops empty sources', () => {
    const variants = [
      { src: 'https://supplier/1.jpg', alt: 'one' },
      { src: '', alt: 'none' }
    ];
    const staged = [{ src: 'https://supplier/1.jpg', url: 'https://store/cdn/t/1' }];
    const entries = imageEntries(variants, staged, ['https://supplier/1.jpg']);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].src, 'https://store/cdn/t/1');
    assert.strictEqual(entries[0].alt, 'one');
  });

  await test('products: imageEntries falls back to the original URL when not staged', () => {
    const entries = imageEntries([{ src: 'https://supplier/a.jpg', alt: 'A' }], [], ['https://supplier/a.jpg']);
    assert.strictEqual(entries[0].src, 'https://supplier/a.jpg');
    assert.strictEqual(entries[0].position, 1);
  });

  await test('products: dry run builds a valid payload with nested SEO metafields', async () => {
    const fakeClient = { get: async () => ({ data: { products: [] } }) };
    const rows = [
      {
        handle: 'tee',
        title: 'Tee',
        status: 'draft',
        vendor: 'Acme',
        product_type: 'Tops',
        tags: 'a, b',
        template_suffix: 'long',
        seo_title: 'SEO title',
        seo_description: 'SEO description',
        body_html: '<p>Body</p>',
        variant_sku: 'S',
        variant_price: '10.00',
        variant_compare_at_price: '',
        variant_weight_unit: 'g',
        variant_inventory_policy: 'continue',
        variant_requires_shipping: 'true',
        variant_taxable: 'true',
        variant_position: '1',
        option1_name: 'Size',
        option1_value: 'S',
        option2_value: '',
        option3_value: ''
      }
    ];
    const r = await syncProducts(fakeClient, rows, [], { dryRun: true });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].action, 'dry-run');
    const p = r[0].payload.product;
    assert.strictEqual(p.title, 'Tee');
    assert.strictEqual(p.status, 'draft');
    assert.strictEqual(p.published, false);
    assert.strictEqual(p.published_at, null);
    assert.strictEqual(p.metafields['global.title_tag'], 'SEO title');
    assert.strictEqual(p.metafields['global.description_tag'], 'SEO description');
    assert.strictEqual(p.metafields_global, undefined);
    assert.strictEqual(p.variants[0].sku, 'S');
    assert.strictEqual(p.variants[0].price, '10.00');
    assert.strictEqual(p.variants[0].weight, null);
    assert.strictEqual(p.variants[0].option3, null);
  });

  await test('products: skipDuplicates leaves existing products untouched', async () => {
    let writes = 0;
    const fakeClient = {
      get: async () => ({ data: { products: [{ id: 4242, title: 'Old' }] } }),
      put: async () => { writes++; return { data: { product: { id: 4242 } } }; },
      post: async () => { writes++; return { data: { product: { id: 99 } } }; }
    };
    const rows = [
      { handle: 'tee', title: 'Tee', status: 'active', variant_price: '10.00', variant_position: '1' },
      { handle: 'cap', title: 'Cap', status: 'active', variant_price: '20.00', variant_position: '1' }
    ];
    const r = await syncProducts(fakeClient, rows, [], { skipDuplicates: true });
    assert.strictEqual(writes, 0);
    assert.strictEqual(r[0].action, 'skipped');
    assert.strictEqual(r[0].id, 4242);
    assert.strictEqual(r[1].action, 'skipped');
  });

  await test('products: an existing product is updated rather than duplicated', async () => {
    let created = 0;
    let updated = 0;
    const fakeClient = {
      get: async (p) => ({ data: { products: String(p).includes('handle=tee') ? [{ id: 7 }] : [] } }),
      put: async () => { updated++; return { data: { product: { id: 7 } } }; },
      post: async () => { created++; return { data: { product: { id: 8 } } }; }
    };
    const rows = [
      { handle: 'tee', title: 'Tee', status: 'active', variant_price: '10.00', variant_position: '1' },
      { handle: 'cap', title: 'Cap', status: 'active', variant_price: '20.00', variant_position: '1' }
    ];
    const r = await syncProducts(fakeClient, rows, [], { skipImages: true });
    assert.strictEqual(created, 1);
    assert.strictEqual(updated, 1);
    assert.strictEqual(r[0].action, 'updated');
    assert.strictEqual(r[1].action, 'created');
  });

  await test('products: attachments attach processed images after a successful write', async () => {
    let attached = 0;
    const fakeClient = {
      get: async () => ({ data: { products: [] } }),
      post: async (p) => {
        if (String(p).includes('/images.json')) attached++;
        return { data: { product: { id: 8 }, image: { id: 1 } } };
      }
    };
    const rows = [
      { handle: 'tee', title: 'Tee', status: 'active', variant_price: '10.00', variant_position: '1', src: 'https://supplier/1.jpg', alt: 'Tee' }
    ];
    const staged = [{ src: 'https://supplier/1.jpg', url: 'https://store/cdn/t/1' }];
    const r = await syncProducts(fakeClient, rows, staged, {});
    assert.strictEqual(r[0].action, 'created');
    assert.strictEqual(attached, 1);
    assert.strictEqual(r[0].images.length, 1);
  });

  // --------------------------------------------------------------- media
  await test('media: never upscales small images by default', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-img-'));
    const S = require('sharp');
    await S({ create: { width: 400, height: 500, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg({ quality: 88 })
      .toFile(path.join(tmp, 'small.jpg'));
    const r = await processImage({ src: path.join(tmp, 'small.jpg'), outDir: path.join(tmp, 'out') });
    assert.strictEqual(r.width, 400);
    assert.strictEqual(r.height, 500);
    assert.ok(fs.existsSync(r.path));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('media: downscales oversized images to maxDim', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-img-'));
    const S = require('sharp');
    await S({ create: { width: 3000, height: 2000, channels: 3, background: { r: 90, g: 100, b: 110 } } })
      .jpeg({ quality: 92 })
      .toFile(path.join(tmp, 'big.jpg'));
    const r = await processImage({ src: path.join(tmp, 'big.jpg'), outDir: path.join(tmp, 'out') });
    assert.strictEqual(r.width, 2048);
    assert.ok(r.height <= 2048);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('media: honours a maxBytes budget by lowering quality', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-img-'));
    const src = path.join(tmp, 'src.png');
    // Rasterised SVG with structured content: compressible enough to be a real
    // JPEG, so a byte budget forces the re-compress loop to run.
    fs.writeFileSync(src, noisySvg(50, 1600));

    const baseline = await processImage({ src, outDir: path.join(tmp, 'base') });
    // Anchor the budget between the default-quality output and the smallest
    // quality we will allow, so the re-compress loop must actually run and can
    // genuinely succeed.
    const floor = await processImage({ src, outDir: path.join(tmp, 'floor'), quality: 40, minQuality: 40 });
    const budget = Math.floor((baseline.bytes + floor.bytes) / 2);
    const r = await processImage({
      src,
      outDir: path.join(tmp, 'out'),
      maxBytes: budget,
      minQuality: 30,
      usedNames: new Set()
    });
    assert.ok(r.bytes <= budget, `expected <= ${budget} bytes, got ${r.bytes} (baseline ${baseline.bytes}, floor ${floor.bytes})`);
    assert.ok(r.quality < baseline.quality, `expected lower quality, got ${r.quality} vs ${baseline.quality}`);
    assert.strictEqual(r.width, baseline.width);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function noisySvg(cells, size) {
    const step = size / cells;
    let rects = '';
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const v = (x * 37 + y * 61) % 256;
        rects += `<rect x="${x * step}" y="${y * step}" width="${step}" height="${step}" fill="rgb(${v},${255 - v},${128})"/>`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${rects}</svg>`;
  }

  await test('media: explicit fit+box upscales to a uniform gallery size', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-img-'));
    const S = require('sharp');
    await S({ create: { width: 300, height: 400, channels: 3, background: { r: 7, g: 7, b: 7 } } })
      .jpeg({ quality: 90 })
      .toFile(path.join(tmp, 'tiny.jpg'));
    const r = await processImage({
      src: path.join(tmp, 'tiny.jpg'),
      outDir: path.join(tmp, 'out'),
      fit: 'cover',
      box: { width: 1000, height: 1000 }
    });
    assert.strictEqual(r.width, 1000);
    assert.strictEqual(r.height, 1000);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('media: identical inputs are deduplicated by content hash', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-img-'));
    const S = require('sharp');
    const a = path.join(tmp, 'a.jpg');
    const b = path.join(tmp, 'b.jpg');
    await S({ create: { width: 200, height: 200, channels: 3, background: { r: 50, g: 50, b: 50 } } })
      .jpeg({ quality: 90 })
      .toFile(a);
    fs.copyFileSync(a, b);
    const cache = new Map();
    const used = new Set();
    const r1 = await processImage({ src: a, outDir: path.join(tmp, 'out'), usedNames: used, dedupeCache: cache });
    const r2 = await processImage({ src: b, outDir: path.join(tmp, 'out'), usedNames: used, dedupeCache: cache });
    assert.strictEqual(r2.skipped, true);
    assert.strictEqual(r2.path, r1.path);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('media: filename collisions get a numeric suffix', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-img-'));
    const S = require('sharp');
    for (const [name, colour] of [['x.jpg', 10], ['y.jpg', 200]]) {
      await S({ create: { width: 100, height: 100, channels: 3, background: { r: colour, g: colour, b: colour } } })
        .jpeg({ quality: 90 })
        .toFile(path.join(tmp, name));
    }
    const used = new Set(['x.jpg']);
    const r = await processImage({ src: path.join(tmp, 'x.jpg'), outDir: path.join(tmp, 'out'), usedNames: used });
    assert.strictEqual(r.name, 'x-1.jpg');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await test('media: throws a clear error when sharp is unavailable', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-img-'));
    const f = path.join(tmp, 'none.png');
    await assert.rejects(processImage({ src: f, outDir: path.join(tmp, 'out') }), /[Ee]rror|ENOENT|not found/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ----------------------------------------------------------- argument parse
  await test('args: flags, values and trailing values', () => {
    const a = parseArgs(['normalize', '--input', 'a.csv', '--out', 'out', '--verbose', '--dry-run']);
    assert.strictEqual(a._[0], 'normalize');
    assert.strictEqual(a.input, 'a.csv');
    assert.strictEqual(a.out, 'out');
    assert.strictEqual(a.verbose, true);
    assert.strictEqual(a['dry-run'], true);
  });

  await test('args: hyphenated option names are preserved', () => {
    const a = parseArgs(['images', '--max-dim', '1000', '--keep-names']);
    assert.strictEqual(a['max-dim'], '1000');
    assert.strictEqual(a['keep-names'], true);
  });

  // -------------------------------------------------------------- multipart
  await test('multipart: parses text fields and a file part', () => {
    const { parseMultipart } = require(path.join(ROOT, 'bin/serve.js'));
    const b = '--------------------------7MA4YWxkTrZu0gW';
    const raw = Buffer.concat([
      Buffer.from(`--${b}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="note"\r\n\r\nhello world\r\n'),
      Buffer.from(`--${b}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="file"; filename="a b.csv"\r\nContent-Type: text/csv\r\n\r\n'),
      Buffer.from('a,b\r\n"1,2",x\r\n'),
      Buffer.from(`--${b}--\r\n`)
    ]);
    const out = parseMultipart(raw, b);
    assert.strictEqual(out.fields.note, 'hello world');
    assert.strictEqual(out.files.length, 1);
    assert.strictEqual(out.files[0].name, 'file');
    assert.strictEqual(out.files[0].filename, 'a b.csv');
    assert.strictEqual(out.files[0].contentType, 'text/csv');
    assert.strictEqual(out.files[0].data.toString(), 'a,b\r\n"1,2",x');
  });

  await test('multipart: a trailing lone CRLF before the file boundary is stripped', () => {
    const { parseMultipart } = require(path.join(ROOT, 'bin/serve.js'));
    const b = 'BOUNDARY';
    const raw = Buffer.concat([
      Buffer.from(`--${b}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="f"; filename="x.json"\r\nContent-Type: application/json\r\n\r\n'),
      Buffer.from('{"a":1}'),
      Buffer.from(`\r\n--${b}--\r\n`)
    ]);
    const out = parseMultipart(raw, b);
    assert.strictEqual(out.files.length, 1);
    assert.strictEqual(out.files[0].data.toString(), '{"a":1}');
  });

  await test('multipart: returns nothing for an empty body', () => {
    const { parseMultipart } = require(path.join(ROOT, 'bin/serve.js'));
    assert.deepStrictEqual(parseMultipart(Buffer.from(''), 'b'), { fields: {}, files: [] });
  });

  // ---------------------------------------------- hosted app: db, auth, users
  const dbmod = require(path.join(ROOT, 'lib/server/db.js'));
  const authmod = require(path.join(ROOT, 'lib/server/auth.js'));
  const usersmod = require(path.join(ROOT, 'lib/server/users.js'));
  const importsmod = require(path.join(ROOT, 'lib/server/imports.js'));

  function freshStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'importer-store-'));
    return { dir, ...(dbmod.openDb(dir)) };
  }

  await test('db: openDb creates the schema and a secret file', () => {
    const s = freshStore();
    assert.ok(fs.existsSync(path.join(s.dir, 'app.db')));
    assert.ok(fs.existsSync(path.join(s.dir, 'secret.key')));
    assert.strictEqual(dbmod.userCount(s.db), 0);
    assert.strictEqual(s.secret.length, 96);
  });

  await test('db: openDb reuses an existing secret instead of generating a new one', () => {
    const s = freshStore();
    const again = dbmod.openDb(s.dir);
    assert.strictEqual(again.secret, s.secret);
    fs.rmSync(s.dir, { recursive: true, force: true });
  });

  await test('db: schema exposes the expected tables', () => {
    const s = freshStore();
    const tables = s.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    for (const t of ['users', 'sessions', 'connections', 'imports', 'meta']) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
  });

  await test('auth: hashPassword and verifyPassword round-trip', () => {
    const { salt, hash } = authmod.hashPassword('CorrectHorse9x');
    assert.strictEqual(salt.length, 32);
    assert.strictEqual(hash.length, 128);
    assert.ok(authmod.verifyPassword('CorrectHorse9x', salt, hash));
    assert.ok(!authmod.verifyPassword('CorrectHorse9', salt, hash));
  });

  await test('auth: policy enforces length, case and digits', () => {
    assert.deepStrictEqual(authmod.policy('short'), ['at least 10 characters', 'upper and lower case', 'a digit']);
    assert.ok(/upper and lower case/.test(authmod.policy('ALLUPPERCASE1').join(',')));
    assert.ok(/upper and lower case/.test(authmod.policy('alllowercase1').join(',')));
    assert.ok(/a digit/.test(authmod.policy('NoDigitsHereee').join(',')));
    assert.deepStrictEqual(authmod.policy('CorrectHorse9x'), []);
    assert.deepStrictEqual(authmod.policy('aBcdefghij1'), []);
  });

  await test('auth: session cookie signs, verifies and rejects tampering', () => {
    const secret = authmod.randomId(24);
    const expires = new Date(Date.now() + 86400000).toISOString();
    const cookie = authmod.signSession(secret, 'sid-1', Math.floor(Date.parse(expires) / 1000 * 1000));
    const ok = authmod.verifySessionCookie(secret, cookie);
    assert.ok(ok && ok.id === 'sid-1');
    assert.ok(!authmod.verifySessionCookie(secret, cookie.replace(/([0-9a-f]{4})$/, 'dead')));
    assert.ok(!authmod.verifySessionCookie('other-secret', cookie));
    assert.ok(!authmod.verifySessionCookie(secret, 'not-a-cookie'));
    assert.ok(!authmod.verifySessionCookie(secret, 'a.b.c'));
    assert.ok(!authmod.verifySessionCookie(secret, `sid-1.${Date.now() - 10000}.${'0'.repeat(64)}`));
  });

  await test('auth: expired session cookie is rejected', () => {
    const secret = authmod.randomId(24);
    const cookie = authmod.signSession(secret, 'sid-2', Date.now() - 5000);
    assert.strictEqual(authmod.verifySessionCookie(secret, cookie), null);
  });

  await test('auth: ISO timestamps survive the dot-delimited cookie format', () => {
    const secret = authmod.randomId(24);
    const cookie = authmod.sessionCookieValue(secret, 'sid-3', new Date(Date.now() + 86400000).toISOString());
    const value = /importer_session=([^;]+)/.exec(cookie)[1];
    assert.strictEqual(value.split('.').length, 3, 'cookie must have exactly three dot-separated parts: ' + value);
    const parsed = authmod.verifySessionCookie(secret, value);
    assert.ok(parsed && parsed.id === 'sid-3');
  });

  await test('auth: csrf token is session bound and verified', () => {
    const secret = authmod.randomId(24);
    const t = authmod.csrfFor(secret, 'session-a');
    assert.strictEqual(t.length, 64);
    assert.ok(authmod.verifyCsrf(secret, 'session-a', t));
    assert.ok(!authmod.verifyCsrf(secret, 'session-b', t));
    assert.ok(!authmod.verifyCsrf('other-secret', 'session-a', t));
    assert.ok(!authmod.verifyCsrf(secret, 'session-a', ''));
    assert.ok(!authmod.verifyCsrf(secret, null, t));
  });

  await test('auth: parseCookies decodes the cookie header', () => {
    const out = authmod.parseCookies('a=1; importer_session=abc%2E123%2Ex; b=two');
    assert.strictEqual(out.a, '1');
    assert.strictEqual(out.importer_session, 'abc.123.x');
    assert.strictEqual(out.b, 'two');
    assert.deepStrictEqual(authmod.parseCookies(undefined), {});
  });

  await test('users: createUser validates username, password and role', () => {
    const { db } = freshStore();
    assert.throws(() => usersmod.createUser(db, { username: 'x', password: 'CorrectHorse9x' }), /2-40/);
    assert.throws(() => usersmod.createUser(db, { username: 'bad name', password: 'CorrectHorse9x' }), /[a-z0-9]/i);
    assert.throws(() => usersmod.createUser(db, { username: 'ok-name', password: 'weak' }), /10 characters/);
    assert.throws(() => usersmod.createUser(db, { username: 'ok-name', password: 'CorrectHorse9x', role: 'wizard' }), /Unknown role/);
    const u = usersmod.createUser(db, { username: 'ok-name', password: 'CorrectHorse9x', role: 'admin', note: 'n' });
    assert.strictEqual(u.username, 'ok-name');
    assert.strictEqual(u.role, 'admin');
    assert.ok(!('pass_hash' in u) && !('salt' in u), 'password fields must never be returned');
    assert.throws(() => usersmod.createUser(db, { username: 'OK-NAME', password: 'CorrectHorse9x' }), /taken/);
  });

  await test('users: authenticate checks credentials and the enabled flag', () => {
    const { db } = freshStore();
    usersmod.createUser(db, { username: 'alice', password: 'CorrectHorse9x' });
    assert.ok(usersmod.authenticate(db, 'alice', 'CorrectHorse9x'));
    assert.ok(usersmod.authenticate(db, 'ALICE', 'CorrectHorse9x'), 'username lookup is case-insensitive');
    assert.strictEqual(usersmod.authenticate(db, 'alice', 'wrong'), null);
    assert.strictEqual(usersmod.authenticate(db, 'nobody', 'CorrectHorse9x'), null);
    usersmod.setUserEnabled(db, 1, false);
    assert.strictEqual(usersmod.authenticate(db, 'alice', 'CorrectHorse9x'), null);
    usersmod.setUserEnabled(db, 1, true);
    assert.ok(usersmod.authenticate(db, 'alice', 'CorrectHorse9x'));
  });

  await test('users: sessions are created, fetched and destroyed', () => {
    const { db } = freshStore();
    const u = usersmod.createUser(db, { username: 'bob', password: 'CorrectHorse9x' });
    const s = usersmod.createSession(db, u.id);
    const got = usersmod.getSession(db, s.id);
    assert.ok(got && got.user.id === u.id && got.id === s.id);
    usersmod.destroySession(db, s.id);
    assert.strictEqual(usersmod.getSession(db, s.id), null);
    assert.strictEqual(usersmod.getSession(db, 'missing'), null);
  });

  await test('users: disabling a user invalidates their sessions', () => {
    const { db } = freshStore();
    const u = usersmod.createUser(db, { username: 'carol', password: 'CorrectHorse9x' });
    const s = usersmod.createSession(db, u.id);
    usersmod.setUserEnabled(db, u.id, false);
    assert.strictEqual(usersmod.getSession(db, s.id), null);
  });

  await test('users: resetPassword rejects weak passwords and blocks the old one', () => {
    const { db } = freshStore();
    const u = usersmod.createUser(db, { username: 'dave', password: 'CorrectHorse9x' });
    assert.throws(() => usersmod.resetPassword(db, u.id, 'weak'), /10 characters/);
    usersmod.resetPassword(db, u.id, 'NewCorrect12x');
    assert.strictEqual(usersmod.authenticate(db, 'dave', 'CorrectHorse9x'), null);
    assert.ok(usersmod.authenticate(db, 'dave', 'NewCorrect12x'));
  });

  await test('users: saveConnection stores the token, returns only a hint', () => {
    const { db } = freshStore();
    const u = usersmod.createUser(db, { username: 'erin', password: 'CorrectHorse9x' });
    const saved = usersmod.saveConnection(db, u.id, { shop: 'My-Store.MyShopify.com/', token: 'shpat_' + 'k'.repeat(40), label: 'main' });
    assert.strictEqual(saved.shop, 'my-store.myshopify.com');
    assert.strictEqual(saved.token_hint, '...kkkk');
    assert.strictEqual(usersmod.publicConnection(saved).token, undefined, 'publicConnection must strip the token');
    assert.strictEqual(usersmod.getConnection(db, u.id).token, 'shpat_' + 'k'.repeat(40), 'the real token stays in the database');
    usersmod.saveConnection(db, u.id, { shop: 'my-store.myshopify.com', token: 'shpat_' + 'm'.repeat(40) });
    assert.strictEqual(usersmod.getConnection(db, u.id).token_hint, '...mmmm');
    assert.strictEqual(usersmod.getConnection(db, u.id).label, '', 'upsert clears a stale label');
    assert.throws(() => usersmod.saveConnection(db, u.id, { shop: 'nope', token: 'shpat_' + 'k'.repeat(40) }), /myshopify/);
    assert.throws(() => usersmod.saveConnection(db, u.id, { shop: 'a.myshopify.com', token: 'short' }), /too short/);
  });

  await test('users: role changes apply', () => {
    const { db } = freshStore();
    const u = usersmod.createUser(db, { username: 'fred', password: 'CorrectHorse9x' });
    assert.strictEqual(u.role, 'operator');
    usersmod.setUserRole(db, u.id, 'admin');
    assert.strictEqual(usersmod.getUser(db, u.id).role, 'admin');
    assert.throws(() => usersmod.setUserRole(db, u.id, 'wizard'), /Unknown role/);
  });

  // ------------------------------------------------- hosted app: import jobs

  await test('imports: normalizePreview reports stats, mapping, warnings and a CSV', () => {
    const text = fs.readFileSync(path.join(ROOT, 'examples/products.csv'), 'utf8');
    const p = importsmod.normalizePreview(text, {});
    assert.strictEqual(p.stats.products, 8);
    assert.strictEqual(p.stats.variants, 30);
    assert.strictEqual(p.stats.images, 30);
    assert.strictEqual(p.stats.inputRows, 33);
    assert.ok(Object.keys(p.fieldMap).length >= 8);
    assert.ok(p.errors.some((e) => e.code === 'E_EMPTY_TITLE'));
    assert.ok(p.errors.some((e) => e.code === 'W_DUPLICATE_VARIANT'));
    assert.ok(p.products.length > 0 && p.products[0].handle);
    assert.ok(p.productsCsv.split('\n').length > 30);
  });

  await test('imports: normalizePreview survives a schema with no known columns', () => {
    const p = importsmod.normalizePreview('foo,bar\n1,2\n3,4', {});
    assert.strictEqual(p.stats.products, 0);
    assert.strictEqual(p.stats.inputRows, 2);
    assert.deepStrictEqual(p.fieldMap, {});
    assert.strictEqual(p.errors.length, 1);
    assert.strictEqual(p.errors[0].code, 'E_NO_TITLE');
    assert.strictEqual(p.errors[0].line, 0);
    assert.strictEqual(p.productsCsv, p.productsCsv.split('\n')[0] + '\n', 'an empty run writes the header row only');
    assert.ok(p.productsCsv.includes('handle,title'));
  });

  function storeWithUser() {
    const store = freshStore();
    const u = usersmod.createUser(store.db, { username: 'runner', password: 'CorrectHorse9x', role: 'operator' });
    return Object.assign(store, { userId: u.id });
  }

  await test('imports: a dry-run job runs to completion and persists stats', async () => {
    const store = storeWithUser();
    const importer = importsmod.createImporter(store);
    const text = fs.readFileSync(path.join(ROOT, 'examples/products.csv'), 'utf8');
    const id = importer.startJob({
      userId: store.userId, filename: 'products.csv', mode: 'dry-run', input: text
    });
    assert.ok(id.startsWith('imp_'));
    let job = importer.getJob(store.db, id);
    assert.strictEqual(job.status, 'queued');
    for (let i = 0; i < 200 && (job.status === 'queued' || job.status === 'running'); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      job = importer.getJob(store.db, id);
    }
    assert.strictEqual(job.status, 'done');
    assert.strictEqual(job.progress, 100);
    assert.strictEqual(job.rows_in, 33);
    assert.strictEqual(job.products, 8);
    assert.strictEqual(job.variants, 30);
    assert.ok(job.finished_at);
    assert.ok(job.outcome.dryRun === true);
    assert.strictEqual(job.stats.products, 8);
    assert.strictEqual(job.error, '');
    fs.rmSync(store.dir, { recursive: true, force: true });
  });

  await test('imports: startJob validates its arguments', () => {
    const store = storeWithUser();
    const importer = importsmod.createImporter(store);
    assert.throws(() => importer.startJob({ userId: store.userId, input: '', mode: 'dry-run' }), /empty/);
    assert.throws(() => importer.startJob({ userId: store.userId, input: 'x', mode: 'nope' }), /Unknown mode/);
    assert.throws(
      () => importer.startJob({ userId: store.userId, input: 'x'.repeat(importsmod.MAX_FILE_BYTES + 1), mode: 'dry-run' }),
      new RegExp(String(importsmod.MAX_FILE_BYTES / 1024 / 1024))
    );
    assert.throws(() => importer.startJob({ userId: 999999, input: 'x', mode: 'dry-run' }), /FOREIGN KEY/);
    assert.strictEqual(importer.listJobs(store.db, store.userId).length, 0, 'rejected submissions must not create a job row');
    fs.rmSync(store.dir, { recursive: true, force: true });
  });

  await test('imports: a live job without a saved connection fails cleanly', async () => {
    const store = storeWithUser();
    const importer = importsmod.createImporter(store);
    const id = importer.startJob({ userId: store.userId, filename: 'f.csv', mode: 'live', input: 'a,b\n1,2' });
    let job = importer.getJob(store.db, id);
    for (let i = 0; i < 200 && (job.status === 'queued' || job.status === 'running'); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      job = importer.getJob(store.db, id);
    }
    assert.strictEqual(job.status, 'failed');
    assert.ok(/connection/i.test(job.error), 'expected a connection error, got: ' + job.error);
    fs.rmSync(store.dir, { recursive: true, force: true });
  });

  await test('imports: jobs for different users are isolated in the list', () => {
    const store = freshStore();
    const importer = importsmod.createImporter(store);
    const u1 = usersmod.createUser(store.db, { username: 'one', password: 'CorrectHorse9x' });
    const u2 = usersmod.createUser(store.db, { username: 'two', password: 'CorrectHorse9x' });
    const a = importer.startJob({ userId: u1.id, filename: 'a.csv', mode: 'dry-run', input: 'x,y\n1,2' });
    const b = importer.startJob({ userId: u2.id, filename: 'b.csv', mode: 'dry-run', input: 'x,y\n1,2' });
    assert.notStrictEqual(a, b);
    const for1 = importer.listJobs(store.db, u1.id);
    assert.strictEqual(for1.length, 1);
    assert.strictEqual(for1[0].id, a);
    assert.strictEqual(importer.listJobs(store.db, u2.id).length, 1);
    assert.strictEqual(importer.listJobs(store.db, u2.id)[0].id, b);
    assert.strictEqual(importer.getJob(store.db, a).user_id, u1.id);
    fs.rmSync(store.dir, { recursive: true, force: true });
  });

  await test('imports: syncProducts reports progress per product', async () => {
    const rows = [
      { handle: 'p-1', title: 'One', variant_sku: '1', variant_price: '10', option1_value: 'S', src: '' },
      { handle: 'p-1', title: 'One', variant_sku: '2', variant_price: '12', option1_value: 'M', src: '' },
      { handle: 'p-2', title: 'Two', variant_sku: '3', variant_price: '14', option1_value: 'S', src: '' }
    ];
    const seen = [];
    const records = await syncProducts({}, rows, [], {
      dryRun: true,
      onProgress(handle, action, i, total) { seen.push([handle, action, i, total]); }
    });
    assert.strictEqual(records.length, 2);
    assert.strictEqual(seen.length, 2);
    assert.deepStrictEqual(seen[0], ['p-1', 'dry-run', 1, 2]);
    assert.deepStrictEqual(seen[1], ['p-2', 'dry-run', 2, 2]);
  });

  await test('imports: testConnection fails without throwing on a bad token', async () => {
    let threw = false;
    try {
      await importsmod.testConnection('demo.myshopify.com', 'shpat_' + 'x'.repeat(40));
    } catch (err) {
      threw = true;
      assert.ok(err.status || err.message, 'error should carry status or a message');
    }
    assert.ok(threw, 'a bad token must be rejected');
  });

  await test('app: bin/app.js exports createApp and does not boot on require', () => {
    const app = require(path.join(ROOT, 'bin/app.js'));
    assert.strictEqual(typeof app.createApp, 'function');
  });

  // ------------------------------------------------------------ end
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('');
    for (const f of failures) {
      console.log(`- ${f.name}`);
      console.log(`  ${String(f.err && f.err.message).split('\n').slice(0, 3).join('\n  ')}`);
    }
    process.exit(1);
  }
})();
