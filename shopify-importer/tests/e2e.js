#!/usr/bin/env node
/* End-to-end API test against a running importer instance. */
'use strict';

const fs = require('fs');

const BASE = process.env.BASE || 'http://127.0.0.1:8082';
let cookie = '';
let csrf = '';
let pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass += 1; console.log(`  ok  ${name}`); }
  else { fail += 1; console.log(` FAIL ${name}${extra ? ' :: ' + extra : ''}`); }
}

async function req(method, path, { body, headers = {}, auth = true } = {}) {
  const h = Object.assign({}, headers);
  if (cookie) h.Cookie = `importer_session=${cookie}`;
  if (csrf && method !== 'GET' && auth) h['x-csrf-token'] = csrf;
  let payload = body;
  if (body && typeof body === 'object' && !(body instanceof Buffer)) {
    h['Content-Type'] = h['Content-Type'] || 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  const sc = res.headers.get('set-cookie');
  if (sc) {
    const m = /importer_session=([^;]+)/.exec(sc);
    if (m) cookie = m[1];
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log('\n[1] anonymous bootstrap + login-CSRF');
  cookie = ''; csrf = '';
  let r = await req('GET', '/api/bootstrap');
  check('bootstrap 200', r.status === 200, r.text);
  check('setupDone false', r.json.setupDone === false);
  check('me null', r.json.me === null);
  csrf = r.json.csrf;
  check('guest csrf issued', typeof csrf === 'string' && csrf.length === 64, csrf);
  check('guest cookie issued', typeof cookie === 'string' && cookie.split('.').length === 3, cookie);

  console.log('\n[2] setup validation');
  r = await req('POST', '/api/setup', { body: { username: 'mallory', password: 'short' } });
  check('weak password rejected', r.status === 400 && /10 characters/.test(r.json.error || ''), r.text);
  r = await req('POST', '/api/setup', { body: { username: 'a', password: 'CorrectHorse9x' } });
  check('short username rejected', r.status === 400, r.text);
  r = await req('POST', '/api/setup', { body: { username: 'Admin One', password: 'CorrectHorse9x' } });
  check('space in username rejected', r.status === 400, r.text);

  console.log('\n[3] setup without csrf');
  const savedCsrf = csrf;
  csrf = '';
  r = await req('POST', '/api/setup', { body: { username: 'admin', password: 'CorrectHorse9x' }, auth: false });
  csrf = savedCsrf;
  check('csrf required', r.status === 403, r.text);

  console.log('\n[4] create first admin');
  r = await req('POST', '/api/setup', { body: { username: 'admin', password: 'CorrectHorse9x' } });
  check('setup 201', r.status === 201, r.text);
  check('admin role', r.json.user && r.json.user.role === 'admin');
  csrf = r.json.csrf;
  check('real session csrf', csrf.length === 64);
  r = await req('GET', '/api/bootstrap');
  check('setupDone true after setup', r.json.setupDone === true);
  check('me populated', r.json.me && r.json.me.username === 'admin');
  r = await req('POST', '/api/setup', { body: { username: 'evil', password: 'CorrectHorse9x' } });
  check('second setup blocked', r.status === 409, r.text);

  console.log('\n[5] tampered cookie rejected');
  const good = cookie;
  cookie = cookie.slice(0, -6) + 'deadbeef';
  r = await req('GET', '/api/me');
  cookie = good;
  check('tampered cookie not authenticated', r.status === 401, r.text);

  console.log('\n[6] logout and login');
  r = await req('POST', '/api/logout');
  check('logout 200', r.status === 200);
  r = await req('GET', '/api/me');
  check('not signed in after logout', r.status === 401);
  csrf = (await req('GET', '/api/bootstrap')).json.csrf;
  r = await req('POST', '/api/login', { body: { username: 'admin', password: 'WRONGPassword1' } });
  check('wrong password rejected', r.status === 401, r.text);
  csrf = (await req('GET', '/api/bootstrap')).json.csrf;
  r = await req('POST', '/api/login', { body: { username: 'admin', password: 'CorrectHorse9x' } });
  check('login ok', r.status === 200, r.text);
  csrf = r.json.csrf;

  console.log('\n[7] normalise a real supplier CSV');
  const csv = fs.readFileSync('/workspace/shopify-importer/examples/products.csv', 'utf8');
  r = await req('POST', '/api/normalize', { body: { text: csv, filename: 'products.csv' } });
  check('normalize 200', r.status === 200, r.text.slice(0, 300));
  const p = r.json;
  check('8 products', p.stats && p.stats.products === 8, JSON.stringify(p.stats));
  check('30 variants', p.stats.variants === 30, String(p.stats.variants));
  check('30 images', p.stats.images === 30, String(p.stats.images));
  check('33 input rows', p.stats.inputRows === 33, String(p.stats.inputRows));
  check('field map present', Object.keys(p.fieldMap || {}).length >= 8, JSON.stringify(p.fieldMap));
  check('warnings captured', Array.isArray(p.errors) && p.errors.length > 0, String(p.errors && p.errors.length));
  check('codes include E_ and W_', p.errors.some((e) => String(e.code).startsWith('E_')) && p.errors.some((e) => String(e.code).startsWith('W_')));
  check('products csv emitted', typeof p.productsCsv === 'string' && p.productsCsv.split('\n').length > 30);

  console.log('\n[8] bad input rejected');
  r = await req('POST', '/api/normalize', { body: { text: 'nope,not,a,real,schema\n1,2,3' } });
  check('garbage normalises without crashing', r.status === 200, r.text.slice(0, 200));
  check('garbage yields 0 products', r.json.stats.products === 0, JSON.stringify(r.json.stats));

  console.log('\n[9] dry-run import job');
  r = await req('POST', '/api/import', { body: { text: csv, filename: 'products.csv', mode: 'dry-run' } });
  check('import accepted', r.status === 202, r.text);
  const id = r.json.id;
  check('job id returned', typeof id === 'string' && id.startsWith('imp_'));
  let job = null;
  for (let i = 0; i < 60; i += 1) {
    job = (await req('GET', '/api/import/' + id)).json;
    if (job && job.status !== 'queued' && job.status !== 'running') break;
    await new Promise((res) => setTimeout(res, 300));
  }
  check('job finished', job && job.status === 'done', job && JSON.stringify(job).slice(0, 300));
  check('progress 100', job && job.progress === 100, String(job && job.progress));
  check('finished_at set', job && !!job.finished_at);
  check('rows_in 33', job && job.rows_in === 33, String(job && job.rows_in));
  check('products 8', job && job.products === 8, String(job && job.products));
  check('variants 30', job && job.variants === 30, String(job && job.variants));
  check('dry-run marked in outcome', job && job.outcome && job.outcome.dryRun === true);
  check('finished at stage', job && /Dry run/i.test(job.stage || ''), job && job.stage);

  console.log('\n[10] history + ownership');
  r = await req('GET', '/api/imports');
  check('history lists the job', r.json.imports.length === 1 && r.json.imports[0].id === id);
  r = await req('GET', '/api/import/imp_doesnotexist');
  check('unknown job 404', r.status === 404);

  console.log('\n[11] live mode without a connection is blocked');
  r = await req('POST', '/api/import', { body: { text: csv, filename: 'products.csv', mode: 'live' } });
  check('live without connection rejected', r.status === 400, r.text);

  console.log('\n[12] connection validation');
  r = await req('POST', '/api/connection', { body: { shop: 'not a url', token: 'shpat_1234567890abcdefghij' } });
  check('bad shop rejected', r.status === 400, r.text);
  r = await req('POST', '/api/connection', { body: { shop: 'demo.myshopify.com', token: 'short' } });
  check('short token rejected', r.status === 400, r.text);
  r = await req('POST', '/api/connection', { body: { shop: 'demo.myshopify.com', token: 'shpat_' + 'x'.repeat(40) } });
  check('connection saved', r.status === 200, r.text);
  check('token never echoed back', !/x{40}/.test(r.text) && !/shpat_x/.test(r.text), r.text);
  check('token hint shown', r.json.connection.token_hint === '...xxxx');
  r = await req('GET', '/api/me');
  check('me returns connection without token', !!r.json.connection.shop && !r.json.connection.token);
  r = await req('POST', '/api/connection', { body: { shop: 'demo.myshopify.com' } });
  check('cannot blank a stored token', r.status === 400, r.text);

  console.log('\n[13] connection test against a fake store fails cleanly');
  r = await req('POST', '/api/connection/test', { body: { shop: 'demo.myshopify.com', token: 'shpat_' + 'x'.repeat(40) } });
  check('test returns an error, not a crash', r.status >= 400 && r.status < 500, r.text.slice(0, 300));

  console.log('\n[14] user management');
  r = await req('GET', '/api/users');
  check('admin can list users', r.status === 200 && r.json.users.length === 1, r.text);
  r = await req('POST', '/api/users', { body: { username: 'op1', password: 'CorrectHorse9x', role: 'operator', note: 'ops' } });
  check('user created', r.status === 201, r.text);
  r = await req('POST', '/api/users', { body: { username: 'op1', password: 'CorrectHorse9x' } });
  check('duplicate username rejected', r.status === 400, r.text);

  const opId = (await req('GET', '/api/users')).json.users.find((u) => u.username === 'op1').id;
  r = await req('POST', '/api/users/' + opId, { body: { role: 'admin' } });
  check('operator promoted to admin', r.status === 200 && r.json.user.role === 'admin');
  const myId = (await req('GET', '/api/me')).json.user.id;
  r = await req('POST', '/api/users/' + myId, { body: { role: 'operator' } });
  check('cannot demote self', r.status === 400, r.text);
  r = await req('POST', '/api/users/' + myId, { body: { enabled: false } });
  check('cannot disable self', r.status === 400, r.text);
  r = await req('POST', '/api/users/' + opId, { body: { password: 'NewCorrect12x' } });
  check('password reset accepted', r.status === 200, r.text);
  r = await req('POST', '/api/users/' + opId, { body: { password: 'weak' } });
  check('weak reset rejected', r.status === 400, r.text);
  r = await req('POST', '/api/users/999', { body: { enabled: false } });
  check('missing user 404', r.status === 404, r.text);
  r = await req('POST', '/api/users/' + opId, { body: { role: 'operator' } });
  check('promoted user demoted back', r.status === 200 && r.json.user.role === 'operator', r.text);

  console.log('\n[15] disabling a user kills login and blocks their session');
  r = await req('POST', '/api/users/' + opId, { body: { enabled: false } });
  check('user disabled', r.status === 200 && r.json.user.enabled === false, r.text);
  await req('POST', '/api/logout');
  csrf = (await req('GET', '/api/bootstrap')).json.csrf;
  r = await req('POST', '/api/login', { body: { username: 'op1', password: 'NewCorrect12x' } });
  check('disabled user cannot sign in', r.status === 401, r.text);
  csrf = (await req('GET', '/api/bootstrap')).json.csrf;
  r = await req('POST', '/api/login', { body: { username: 'admin', password: 'CorrectHorse9x' } });
  csrf = r.json.csrf;
  r = await req('POST', '/api/users/' + opId, { body: { enabled: true } });
  check('user re-enabled', r.status === 200 && r.json.user.enabled === true, r.text);
  await req('POST', '/api/logout');
  csrf = (await req('GET', '/api/bootstrap')).json.csrf;
  r = await req('POST', '/api/login', { body: { username: 'op1', password: 'NewCorrect12x' } });
  check('re-enabled user signs in', r.status === 200, r.text);
  csrf = r.json.csrf;
  r = await req('GET', '/api/users');
  check('operator cannot list users', r.status === 403, r.text);
  r = await req('POST', '/api/users', { body: { username: 'x1', password: 'CorrectHorse9x' } });
  check('operator cannot create users', r.status === 403);
  r = await req('POST', '/api/normalize', { body: { text: csv, filename: 'products.csv' } });
  check('operator can normalise', r.status === 200 && r.json.stats.products === 8);
  r = await req('POST', '/api/import', { body: { text: csv, filename: 'products.csv', mode: 'dry-run' } });
  check('operator can run a dry run', r.status === 202, r.text);
  const opJob = r.json.id;
  for (let i = 0; i < 60; i += 1) {
    const j = (await req('GET', '/api/import/' + opJob)).json;
    if (j.status !== 'queued' && j.status !== 'running') break;
    await new Promise((res) => setTimeout(res, 300));
  }
  check('operator job completed', (await req('GET', '/api/import/' + opJob)).json.status === 'done');
  r = await req('GET', '/api/imports');
  check('operator sees only their own history', r.json.imports.every((j) => j.user_id !== myId), JSON.stringify(r.json.imports.map((j) => j.user_id)));

  console.log('\n[16] cross-user job access');
  csrf = (await req('GET', '/api/bootstrap')).json.csrf;
  r = await req('POST', '/api/login', { body: { username: 'admin', password: 'CorrectHorse9x' } });
  csrf = r.json.csrf;
  r = await req('GET', '/api/import/' + opJob);
  check('admin cannot read another user job', r.status === 403, r.text);

  console.log('\n[17] multipart upload (the browser path)');
  async function upload(filePayload, filename, contentType, extra) {
    const fd = new FormData();
    fd.append('file', new Blob([filePayload], { type: contentType }), filename);
    for (const [k, v] of Object.entries(extra || {})) fd.append(k, v);
    const res = await fetch(BASE + '/api/normalize', {
      method: 'POST',
      headers: { cookie: `importer_session=${cookie}`, 'x-csrf-token': csrf },
      body: fd
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, json, text };
  }
  r = await upload(csv, 'products.csv', 'text/csv');
  check('multipart normalize 200', r.status === 200, r.text.slice(0, 200));
  check('multipart filename kept', r.json.filename === 'products.csv', r.json.filename);
  check('multipart yields 8 products', r.json.stats.products === 8, String(r.json.stats && r.json.stats.products));
  check('multipart yields 33 rows', r.json.stats.inputRows === 33, String(r.json.stats && r.json.stats.inputRows));
  r = await upload('not a csv at all', 'readme.txt', 'text/plain');
  check('unsupported extension rejected', r.status === 400 && /Unsupported file type/.test(r.json.error || ''), r.text);
  r = await upload('{"rows":[{"title":"T","sku":"1","price":"9"}]}', 'feed.json', 'application/json');
  check('json file accepted', r.status === 200 && r.json.stats.products === 1, r.text.slice(0, 200));

  console.log('\n----------------------------------------');
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('harness error:', err);
  process.exit(2);
});
