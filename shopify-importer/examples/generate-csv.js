'use strict';

/**
 * Generates examples/products.csv. Hand-writing a 20-column CSV by eye is a
 * sure way to misalign columns, so the fixture is produced programmatically
 * and the alignment is provably correct.
 */

const fs = require('fs');
const path = require('path');

const HEADER = [
  'title',
  'handle',
  'description',
  'vendor',
  'product_type',
  'tags',
  'status',
  'sku',
  'price',
  'compare_at_price',
  'weight',
  'weight_unit',
  'option1_name',
  'option1_value',
  'option2_name',
  'option2_value',
  'collection_list',
  'seo_title',
  'seo_description',
  'image_src',
  'image_alt'
];

const VENDOR = 'House Standard';
const rows = [];

function row(partial) {
  const r = Object.fromEntries(HEADER.map((h) => [h, '']));
  Object.assign(r, partial);
  rows.push(r);
}

function tee(size, colour, idx) {
  const sku = `CT-TEE-${size}-${colour}`;
  row({
    title: 'Essential Cotton Tee',
    handle: 'essential-cotton-tee',
    description: '<p>Midweight combed cotton tee with a relaxed cut and reinforced collar.</p>',
    vendor: VENDOR,
    product_type: 'Tees',
    tags: 'new-season, bestseller',
    status: 'active',
    sku,
    price: size === 'XL' ? '$42.00' : '$38.00',
    compare_at_price: size === 'XL' ? '$52.00' : '$48.00',
    weight: (10 + idx).toString(),
    weight_unit: 'oz',
    option1_name: 'Size',
    option1_value: size,
    option2_name: 'Colour',
    option2_value: colour,
    collection_list: 'Tops, New Arrivals',
    seo_title: 'Essential Cotton Tee',
    seo_description: 'Short sleeve combed cotton tee with a relaxed cut.',
    image_src: `https://supplier.example/media/tee-${colour.toLowerCase()}-${size.toLowerCase()}.jpg`,
    image_alt: `Essential tee in ${colour.toLowerCase()}, size ${size}`
  });
}

['S', 'M', 'L', 'XL'].forEach((s, i) => tee(s, 'Black', i));
['S', 'M', 'L'].forEach((s, i) => tee(s, 'Oatmeal', i + 4));

function denim(size, waist) {
  row({
    title: 'Relaxed Selvedge Denim',
    handle: 'relaxed-selvedge-denim',
    description: '14 oz Japanese selvedge denim, tapered through the leg with a mid rise.',
    vendor: VENDOR,
    product_type: 'Denim',
    tags: 'preorder',
    status: 'draft',
    sku: `CT-DEN-${waist}`,
    price: size === 'S' ? '24.00' : '28.00',
    compare_at_price: size === 'S' ? '$32.00' : '$36.00',
    weight: size === 'S' ? '1.6' : '1.9',
    weight_unit: 'lb',
    option1_name: 'Size',
    option1_value: waist,
    option2_name: 'Colour',
    option2_value: 'Indigo',
    collection_list: 'Bottoms, Denim',
    seo_title: `Relaxed Selvedge Denim ${waist}w`,
    seo_description: '14 oz Japanese selvedge denim, tapered.',
    image_src: `https://supplier.example/media/denim-${waist}.jpg`,
    image_alt: `Indigo selvedge denim ${waist}w`
  });
}

denim('S', 30);
denim('M', 32);
denim('L', 34);

row({
  title: 'Structured Wool Coat',
  handle: 'structured-wool-coat',
  description: 'Double-faced Italian wool blend, fully lined with a hidden placket.',
  vendor: VENDOR,
  product_type: 'Outerwear',
  tags: 'new-season',
  status: 'active',
  sku: 'CT-COA-M-CHR',
  price: '$289.00',
  compare_at_price: '$340.00',
  weight: '3.4',
  weight_unit: 'lb',
  option1_name: 'Size',
  option1_value: 'M',
  option2_name: 'Colour',
  option2_value: 'Charcoal',
  collection_list: 'Outerwear, New Arrivals',
  seo_title: 'Structured Wool Coat',
  seo_description: 'Double-faced Italian wool blend, fully lined.',
  image_src:
    'https://supplier.example/media/coat-charcoal.jpg,https://supplier.example/media/coat-charcoal-back.jpg,https://supplier.example/media/coat-charcoal-detail.jpg',
  image_alt: 'Charcoal structured wool coat'
});

row({
  title: 'Structured Wool Coat',
  handle: 'structured-wool-coat',
  vendor: VENDOR,
  product_type: 'Outerwear',
  tags: 'new-season',
  status: 'active',
  sku: 'CT-COA-L-CHR',
  price: '€289,00',
  weight: '3.8',
  weight_unit: 'lb',
  option1_name: 'Size',
  option1_value: 'L',
  option2_name: 'Colour',
  option2_value: 'Charcoal',
  collection_list: 'Outerwear, New Arrivals',
  image_src: 'https://supplier.example/media/coat-charcoal.jpg',
  image_alt: 'Charcoal structured wool coat'
});

row({
  title: 'Structured Wool Coat',
  handle: 'structured-wool-coat',
  vendor: VENDOR,
  product_type: 'Outerwear',
  tags: 'new-season',
  status: 'active',
  sku: 'CT-COA-M-NVY',
  price: '$310.00',
  compare_at_price: '$360.00',
  weight: '3.6',
  weight_unit: 'lb',
  option1_name: 'Size',
  option1_value: 'M',
  option2_name: 'Colour',
  option2_value: 'Navy',
  collection_list: 'Outerwear, New Arrivals',
  image_src: 'https://supplier.example/media/coat-navy.jpg',
  image_alt: 'Navy structured wool coat'
});

function sweater(size, colour, idx) {
  row({
    title: 'Merino Rib Knit Sweater',
    handle: 'merino-rib-knit-sweater',
    description: 'Full-gauge merino with a fine rib across the body and cuffs.',
    vendor: VENDOR,
    product_type: 'Knitwear',
    tags: 'new-season',
    status: 'active',
    sku: `CT-SWE-${size}-${colour}`,
    price: '$128.00',
    weight: (180 + idx * 20).toString(),
    weight_unit: 'g',
    option1_name: 'Size',
    option1_value: size,
    option2_name: 'Colour',
    option2_value: colour,
    collection_list: 'Knitwear, New Arrivals',
    seo_title: 'Merino Rib Knit Sweater',
    seo_description: 'Fine gauge merino knit with a body rib.',
    image_src: `https://supplier.example/media/sweater-${colour.toLowerCase()}-${size.toLowerCase()}.jpg`,
    image_alt: `${colour} merino knit, size ${size}`
  });
}

['S', 'M', 'L'].forEach((s, i) => sweater(s, 'Oat', i));
['S', 'M'].forEach((s, i) => sweater(s, 'Ink', i + 3));

function trouser(size, waist, colour) {
  row({
    title: 'Canvas Utility Trouser',
    handle: 'canvas-utility-trouser',
    description: '12 oz cotton canvas with a drawcord waist and five pockets.',
    vendor: VENDOR,
    product_type: 'Bottoms',
    tags: 'new-season',
    status: 'active',
    sku: `CT-TR-${waist}-${colour}`,
    price: waist >= 34 ? '$30.00' : '$28.00',
    compare_at_price: waist >= 34 ? '$36.00' : '$34.00',
    weight: (1.2 + waist / 40).toFixed(2),
    weight_unit: 'lb',
    option1_name: 'Size',
    option1_value: waist,
    option2_name: 'Colour',
    option2_value: colour,
    collection_list: 'Bottoms, New Arrivals',
    seo_title: `Canvas Utility Trouser ${waist}w`,
    seo_description: '12 oz cotton canvas with a drawcord waist.',
    image_src: `https://supplier.example/media/trouser-${colour.toLowerCase()}-${waist}.jpg`,
    image_alt: `${colour} canvas trouser ${waist}w`
  });
}

trouser('S', 28, 'Cream');
trouser('M', 30, 'Cream');
trouser('L', 32, 'Cream');
trouser('XL', 34, 'Cream');
trouser('M', 30, 'Olive');

function beanie(size, colour, idx) {
  row({
    title: 'Wool Beanie',
    handle: 'wool-beanie',
    description: 'Simple eight-panel knit beanie in a wool and mohair blend.',
    vendor: VENDOR,
    product_type: 'Accessories',
    tags: 'new-season',
    status: 'active',
    sku: `CT-BN-${idx}-${colour}`,
    price: '$34.00',
    weight: '2',
    weight_unit: 'oz',
    option1_name: 'Size',
    option1_value: 'One Size',
    option2_name: 'Colour',
    option2_value: colour,
    collection_list: 'Accessories',
    seo_title: 'Wool Beanie',
    seo_description: 'Eight panel wool and mohair blend beanie.',
    image_src: `https://supplier.example/media/beanie-${colour.toLowerCase()}.jpg`,
    image_alt: `${colour} wool beanie`
  });
}

beanie('One Size', 'Black', 0);
beanie('One Size', 'Cream', 1);

function hoodie(size, idx) {
  row({
    title: 'Heavyweight Hoodie',
    handle: 'heavyweight-hoodie',
    description: '12 oz loopback french terry, garment dyed and pre-shrunk.',
    vendor: VENDOR,
    product_type: 'Sweatshirts',
    tags: 'preorder',
    status: 'active',
    sku: `CT-HD-${size}-${idx}`,
    price: '$148.00',
    compare_at_price: '$175.00',
    weight: (1.9 + idx * 0.1).toFixed(2),
    weight_unit: 'lb',
    option1_name: 'Size',
    option1_value: size,
    option2_name: 'Colour',
    option2_value: 'Khaki',
    collection_list: 'Sweatshirts, New Arrivals',
    seo_title: 'Heavyweight Hoodie',
    seo_description: '12 oz loopback french terry, garment dyed.',
    image_src: `https://supplier.example/media/hoodie-khaki-${size.toLowerCase()}.jpg`,
    image_alt: `Khaki heavyweight hoodie, size ${size}`
  });
}

['S', 'M', 'L'].forEach((s, i) => hoodie(s, i));

// ---- Deliberate edge cases so the normaliser has something to defend against

row({
  title: 'Orphan Row',
  handle: 'orphan-row',
  vendor: VENDOR,
  product_type: 'Accessories',
  status: 'active',
  sku: 'CT-ORPHAN',
  price: '$15.00',
  weight: '1',
  weight_unit: 'oz',
  option1_name: 'Size',
  option1_value: 'One Size',
  option2_name: 'Colour',
  option2_value: 'Black',
  collection_list: 'Accessories',
  image_src: 'https://supplier.example/media/orphan.jpg',
  image_alt: 'Orphan listing'
});

row({
  title: '',
  handle: 'missing-title',
  vendor: VENDOR,
  product_type: 'Accessories',
  status: 'active',
  sku: 'CT-MISSING-TITLE',
  price: '$19.00',
  weight: '1',
  weight_unit: 'oz',
  option1_name: 'Size',
  option1_value: 'One Size',
  option2_name: 'Colour',
  option2_value: 'Black',
  collection_list: 'Accessories',
  image_src: 'https://supplier.example/media/notitle.jpg',
  image_alt: 'Row with no title'
});

row({
  title: 'Broken Row',
  handle: 'broken-row',
  vendor: VENDOR,
  product_type: 'Misfit',
  tags: 'test',
  status: 'active',
  sku: 'CT-BROKEN',
  price: '',
  weight: '200',
  weight_unit: 'g',
  option1_name: 'Size',
  option1_value: 'M',
  option2_name: 'Colour',
  option2_value: 'Black',
  collection_list: 'Misc',
  image_src: 'https://supplier.example/media/broken.jpg',
  image_alt: 'Row with no price'
});

// Duplicate SKU: must be dropped by deduplication
row({
  title: 'Canvas Utility Trouser',
  handle: 'canvas-utility-trouser',
  vendor: VENDOR,
  product_type: 'Bottoms',
  tags: 'new-season',
  status: 'active',
  sku: 'CT-TR-30-Cream',
  price: '$28.00',
  compare_at_price: '$34.00',
  weight: '1.30',
  weight_unit: 'lb',
  option1_name: 'Size',
  option1_value: '30',
  option2_name: 'Colour',
  option2_value: 'Cream',
  collection_list: 'Bottoms, New Arrivals',
  image_src: 'https://supplier.example/media/trouser-cream-30.jpg',
  image_alt: 'Cream canvas trouser 30w duplicate'
});

// Duplicate SKU with a conflicting price: same defence, different price
row({
  title: 'Heavyweight Hoodie',
  handle: 'heavyweight-hoodie',
  vendor: VENDOR,
  product_type: 'Sweatshirts',
  tags: 'preorder',
  status: 'active',
  sku: 'CT-HD-M-0',
  price: '$160.00',
  compare_at_price: '$190.00',
  weight: '2.00',
  weight_unit: 'lb',
  option1_name: 'Size',
  option1_value: 'M',
  option2_name: 'Colour',
  option2_value: 'Khaki',
  collection_list: 'Sweatshirts, New Arrivals',
  image_src: 'https://supplier.example/media/hoodie-khaki-m.jpg',
  image_alt: 'Duplicate hoodie with a different price'
});

// ---- writer ----

function quoteField(v) {
  const s = v === undefined || v === null ? '' : String(v);
  if (!s) return '';
  if (/^[^",\n\r]+$/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

const lines = [HEADER.map(quoteField).join(',')];
for (const r of rows) {
  lines.push(HEADER.map((h) => quoteField(r[h])).join(','));
}
const out = lines.join('\n') + '\n';

const target = path.join(__dirname, 'products.csv');
fs.writeFileSync(target, out, 'utf8');
console.log(`wrote ${target} (${rows.length} data rows, ${HEADER.length} columns)`);
