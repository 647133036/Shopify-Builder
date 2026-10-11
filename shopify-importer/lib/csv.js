'use strict';

/**
 * RFC 4180 CSV reader/writer.
 * Handles quoted fields, escaped quotes (""), commas and newlines inside quotes,
 * CRLF/LF line endings, BOM, and optional header mapping.
 */

function parse(text, opts) {
  const o = Object.assign({ delimiter: ',', quote: '"', trim: false, stripBom: true }, opts || {});
  if (o.stripBom && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const delim = o.delimiter;
  const q = o.quote;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === q) {
        if (text[i + 1] === q) {
          // Escaped quote: consume both quote characters.
          field += q;
          i++;
          continue;
        }
        // Closing quote: consume only the quote itself.
        inQuotes = false;
        continue;
      }
      field += c;
      continue;
    }

    if (c === q) {
      // Opening quote: consume only the quote itself.
      inQuotes = true;
      continue;
    }
    if (c === delim) {
      row.push(o.trim ? field.trim() : field);
      field = '';
      continue;
    }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(o.trim ? field.trim() : field);
      field = '';
      rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }

  if (field.length || row.length) {
    row.push(o.trim ? field.trim() : field);
    rows.push(row);
  }

  return rows;
}

function parseToObjects(text, opts) {
  const rows = parse(text, opts);
  const header = (rows.shift() || []).map((h) => String(h));
  return rows
    .filter((r) => !(r.length === 1 && r[0] === ''))
    .map((r) => {
      const obj = {};
      header.forEach((key, idx) => {
        if (key) obj[key] = r[idx] === undefined ? '' : r[idx];
      });
      return obj;
    });
}

function needsQuote(value, quoteChar) {
  const s = String(value);
  const q = quoteChar || '"';
  if (!s.length) return false;
  return (
    s.indexOf(',') >= 0 ||
    s.indexOf(q) >= 0 ||
    s.indexOf('\n') >= 0 ||
    s.indexOf('\r') >= 0
  );
}

function serializeField(value, quoteChar) {
  const s = value === undefined || value === null ? '' : String(value);
  if (s.startsWith(' ')) {
    const q = quoteChar || '"';
    return q + s.replace(new RegExp(q, 'g'), q + q) + q;
  }
  if (!needsQuote(s, quoteChar)) return s;
  const q = quoteChar || '"';
  return q + s.replace(new RegExp(q, 'g'), q + q) + q;
}

/**
 * Serialize rows of objects to CSV.
 * headers: explicit column order; omitted values are written as empty strings.
 */
function stringify(rows, headers, opts) {
  const o = Object.assign({ delimiter: ',', quote: '"', lineEnding: '\n' }, opts || {});
  const cols = headers && headers.length ? headers : collectHeaders(rows);
  const out = [cols.map((h) => serializeField(h, o.quote)).join(o.delimiter)];

  for (const row of rows) {
    out.push(cols.map((h) => serializeField(row[h], o.quote)).join(o.delimiter));
  }
  return out.join(o.lineEnding) + o.lineEnding;
}

function collectHeaders(rows) {
  const seen = [];
  const set = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!set.has(key)) {
        set.add(key);
        seen.push(key);
      }
    }
  }
  return seen;
}

module.exports = { parse, parseToObjects, stringify, serializeField, needsQuote };
