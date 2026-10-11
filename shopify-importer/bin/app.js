#!/usr/bin/env node
'use strict';

/**
 * Hosted importer: multi-user web app.
 *
 * node bin/app.js --port 3000 --data ./data
 *
 * First run has no users: the /app screen shows a one-time setup form that
 * creates the first admin account. After that, users sign in with
 * username/password and each stores their own Shopify credentials.
 *
 * Dependencies: none. Storage is node:sqlite; passwords are scrypt.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { openDb, userCount, nowIso } = require('../lib/server/db');
const auth = require('../lib/server/auth');
const users = require('../lib/server/users');
const imports = require('../lib/server/imports');
const { parseMultipart } = require('./serve');

const WEB_DIR = path.join(__dirname, '..', 'web');
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const VERSION = require('../package.json').version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// ------------------------------------------------------------------- responses

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendHtml(res, code, body, extraHeaders = {}) {
  res.writeHead(code, Object.assign({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extraHeaders));
  res.end(body);
}

function serveStatic(res, rel) {
  const file = path.join(WEB_DIR, path.normalize(rel));
  if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return sendHtml(res, 404, '<h1>404</h1>');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readInput(req) {
  const type = req.headers['content-type'] || '';
  const buf = await readBody(req);
  if (/multipart\/form-data/i.test(type)) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type);
    if (!m) throw new Error('multipart request without a boundary');
    const { fields, files } = parseMultipart(buf, m[1] || m[2]);
    let file = files[0];
    if (!file && fields.file) file = { filename: 'input.csv', contentType: 'text/csv', data: Buffer.from(fields.file) };
    if (!file) throw new Error('No file uploaded. Drag a .csv or .json file into the drop zone.');
    if (!/\.csv$|\.json$/i.test(file.filename || '')) {
      throw new Error(`Unsupported file type "${file.filename}". Upload a .csv or .json file.`);
    }
    return { text: file.data.toString('utf8'), filename: file.filename, fields };
  }
  if (/application\/json/i.test(type)) {
    const raw = buf.toString('utf8');
    let obj = {};
    try { obj = JSON.parse(raw || '{}'); } catch (e) { throw new Error('Request body is not valid JSON.'); }
    if (typeof obj.text === 'string') return { text: obj.text, filename: obj.filename || 'input.csv', fields: obj };
    if (Array.isArray(obj.rows)) {
      return { text: obj.rows.map((r) => JSON.stringify(r)).join('\n'), filename: obj.filename || 'input.json', fields: obj };
    }
    // A JSON body with neither "text" nor "rows" is a form payload (login,
    // setup, user management) rather than import data; hand it back as-is.
    return { text: raw, filename: obj.filename || 'payload.json', fields: obj };
  }
  return { text: buf.toString('utf8'), filename: 'input.csv', fields: {} };
}

// ----------------------------------------------------------------------- routing

function parseRoute(pattern, pathname) {
  const pp = pattern.split('/');
  const xp = pathname.split('/');
  if (pp.length !== xp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i += 1) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(xp[i]);
    else if (pp[i] !== xp[i]) return null;
  }
  return params;
}

// ----------------------------------------------------------------- login limiting

function loginLimiter(max = 5, windowMs = 15 * 60 * 1000) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, v] of hits) if (v[0] < cutoff) hits.delete(k);
  }, 60 * 60 * 1000).unref();

  return {
    blocked(key) {
      const v = hits.get(key);
      if (!v) return false;
      return v[0] > Date.now() - windowMs && v[1] >= max;
    },
    record(key) {
      const now = Date.now();
      const v = hits.get(key);
      if (!v || v[0] < now - windowMs) hits.set(key, [now, 1]);
      else v[1] += 1;
    }
  };
}

// ---------------------------------------------------------------------- the app

function createApp(opts = {}) {
  const { port = Number(process.env.PORT) || 3000, host = '0.0.0.0', dataDir = './data' } = opts;
  const { db, secret } = openDb(dataDir);
  const limiter = loginLimiter();
  const importer = imports.createImporter({ db, secret });

  const state = {
    db,
    secret,
    user: null,
    csrf: null,
    cookies: {}
  };

  function setupDone() {
    return userCount(db) > 0;
  }

  function needAuth(h) {
    return (req, res, params) => {
      if (!state.user) return sendJson(res, 401, { error: 'Not signed in.' });
      return h(req, res, params);
    };
  }

  function needAdmin(h) {
    return (req, res, params) => {
      if (!state.user) return sendJson(res, 401, { error: 'Not signed in.' });
      if (state.user.role !== 'admin') return sendJson(res, 403, { error: 'Admin only.' });
      return h(req, res, params);
    };
  }

  function setSession(res, session) {
    res.setHeader('Set-Cookie', auth.sessionCookieValue(secret, session.id, session.expires_at));
    state.csrf = auth.csrfFor(secret, session.id);
  }

  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, pattern, handler });

  // ------------------------------------------------------------ public endpoints

  add('GET', '/api/health', (req, res) => {
    sendJson(res, 200, { ok: true, service: 'shopify-importer', version: VERSION });
  });

  add('GET', '/api/bootstrap', (req, res) => {
    sendJson(res, 200, {
      setupDone: setupDone(),
      me: state.user,
      csrf: state.csrf || ''
    });
  });

  add('POST', '/api/setup', async (req, res) => {
    if (setupDone()) return sendJson(res, 409, { error: 'This deployment is already initialised.' });
    const { text } = await readInput(req);
    let body = {};
    try { body = JSON.parse(text || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON.' }); }
    try {
      const user = users.createUser(db, {
        username: body.username,
        password: body.password,
        role: 'admin',
        note: 'First account'
      });
      const session = users.createSession(db, user.id);
      setSession(res, session);
      sendJson(res, 201, { ok: true, user: users.rowToUser(user), csrf: state.csrf });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });

  add('POST', '/api/login', async (req, res) => {
    const ip = req.socket.remoteAddress || 'unknown';
    if (limiter.blocked(ip)) return sendJson(res, 429, { error: 'Too many failed sign-in attempts. Wait a few minutes.' });
    const { text } = await readInput(req);
    let body = {};
    try { body = JSON.parse(text || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON.' }); }
    const user = users.authenticate(db, body.username, body.password);
    if (!user) {
      limiter.record(ip);
      return sendJson(res, 401, { error: 'Wrong username or password.' });
    }
    limiter.record(`${ip}:${user.id}`);
    const session = users.createSession(db, user.id);
    setSession(res, session);
    sendJson(res, 200, { ok: true, user: users.rowToUser(user), csrf: state.csrf });
  });

  add('POST', '/api/logout', (req, res) => {
    if (state.sessionId) users.destroySession(db, state.sessionId);
    res.setHeader('Set-Cookie', auth.clearSessionCookie());
    state.user = null;
    state.csrf = null;
    sendJson(res, 200, { ok: true });
  });

  // ------------------------------------------------------- authenticated API

  add('GET', '/api/me', needAuth((req, res) => {
    sendJson(res, 200, {
      user: state.user,
      csrf: state.csrf,
      connection: users.publicConnection(users.getConnection(db, state.user.id))
    });
  }));

  add('POST', '/api/connection/test', needAuth(async (req, res) => {
    let body = {};
    try { body = JSON.parse((await readInput(req)).text || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON.' }); }
    const shop = body.shop || (users.getConnection(db, state.user.id) || {}).shop;
    const token = body.token || (users.getConnection(db, state.user.id) || {}).token;
    if (!shop || !token) return sendJson(res, 400, { error: 'Shop and token are required.' });
    try {
      sendJson(res, 200, await importer.testConnection(shop, token));
    } catch (err) {
      const status = err.status || 500;
      const code = err.data && err.data.errors && (err.data.errors[0] || err.data.errors.message);
      sendJson(res, status > 499 ? 502 : 401, { ok: false, status, error: code || err.message });
    }
  }));

  add('POST', '/api/connection', needAuth(async (req, res) => {
    let body = {};
    try { body = JSON.parse((await readInput(req)).text || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON.' }); }
    if (!body.token) {
      return sendJson(res, 400, { error: 'Token is required. Paste a new token to replace the stored one.' });
    }
    try {
      const saved = users.saveConnection(db, state.user.id, {
        shop: body.shop, token: body.token, label: body.label || ''
      });
      sendJson(res, 200, { ok: true, connection: users.publicConnection(saved) });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  }));

  add('POST', '/api/normalize', needAuth(async (req, res) => {
    try {
      const { text, filename, fields } = await readInput(req);
      const type = req.headers['content-type'] || '';
      const parsed = Object.assign({}, fields);
      if (parsed.text === undefined && !Array.isArray(parsed.rows) && /application\/json/i.test(type)) {
        return sendJson(res, 400, { error: 'Upload a file, or send JSON with a "text" or "rows" field.' });
      }
      const payload = parsed.text || text;
      if (!payload || !payload.trim()) return sendJson(res, 400, { error: 'The upload is empty.' });
      const preview = importer.normalizePreview(payload, { filename });
      sendJson(res, 200, Object.assign({ filename }, preview));
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  }));

  add('POST', '/api/import', needAuth(async (req, res) => {
    const hasConn = !!users.getConnection(db, state.user.id);
    try {
      const { text, filename, fields } = await readInput(req);
      const type = req.headers['content-type'] || '';
      const parsed = Object.assign({}, fields);
      const mode = parsed.mode === 'live' ? 'live' : 'dry-run';
      const hasPayload = parsed.text !== undefined || Array.isArray(parsed.rows) || !/application\/json/i.test(type);
      if (!hasPayload) {
        return sendJson(res, 400, { error: 'Upload a file, or send JSON with a "text" or "rows" field.' });
      }
      const id = importer.startJob({
        userId: state.user.id,
        filename: parsed.filename || filename || 'upload.csv',
        mode,
        input: parsed.text || text,
        processImages: parsed.processImages === true || parsed.processImages === 'true',
        skipDuplicates: parsed.skipDuplicates === true || parsed.skipDuplicates === 'true'
      });
      if (mode === 'live' && !hasConn) {
        sendJson(res, 400, { error: 'No Shopify connection saved. Add your store and token first.', id });
      } else {
        sendJson(res, 202, { ok: true, id, mode, queued: true });
      }
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  }));

  add('GET', '/api/import/:id', needAuth((req, res, params) => {
    const job = importer.getJob(db, params.id);
    if (!job) return sendJson(res, 404, { error: 'Job not found.' });
    if (job.user_id !== state.user.id) return sendJson(res, 403, { error: 'Not your job.' });
    sendJson(res, 200, job);
  }));

  add('GET', '/api/imports', needAuth((req, res) => {
    sendJson(res, 200, { imports: importer.listJobs(db, state.user.id, 100) });
  }));

  // -------------------------------------------------------------- admin routes

  add('GET', '/api/users', needAdmin((req, res) => {
    sendJson(res, 200, { users: users.listUsers(db) });
  }));

  add('POST', '/api/users', needAdmin(async (req, res) => {
    let body = {};
    try { body = JSON.parse((await readInput(req)).text || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON.' }); }
    try {
      const user = users.createUser(db, body);
      sendJson(res, 201, { ok: true, user: users.rowToUser(user) });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  }));

  add('POST', '/api/users/:id', needAdmin(async (req, res, params) => {
    const id = Number(params.id);
    const target = users.getUser(db, id);
    if (!target) return sendJson(res, 404, { error: 'User not found.' });
    let body = {};
    try { body = JSON.parse((await readInput(req)).text || '{}'); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON.' }); }
    try {
      if (typeof body.enabled === 'boolean') {
        if (target.id === state.user.id && !body.enabled) return sendJson(res, 400, { error: 'You cannot disable your own account.' });
        users.setUserEnabled(db, id, body.enabled);
      }
      if (typeof body.role === 'string') {
        if (target.id === state.user.id) return sendJson(res, 400, { error: 'You cannot change your own role.' });
        users.setUserRole(db, id, body.role);
      }
      if (typeof body.password === 'string' && body.password) users.resetPassword(db, id, body.password);
      if (typeof body.note === 'string') db.prepare('UPDATE users SET note = ? WHERE id = ?').run(body.note, id);
      sendJson(res, 200, { ok: true, user: users.getUser(db, id) });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  }));

  // ------------------------------------------------------------------ requests

  function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const ip = req.socket.remoteAddress || 'unknown';

    res.setHeader('X-Content-Type-Options', 'nosniff');

    const cookies = auth.parseCookies(req.headers.cookie || '');
    state.cookies = cookies;
    const cookieSession = auth.verifySessionCookie(secret, cookies[auth.COOKIE_NAME]);
    const session = cookieSession ? users.getSession(db, cookieSession.id) : null;
    state.user = session ? session.user : null;

    // A valid cookie gives a stable CSRF seed. When there is none, mint an
    // anonymous one and ship it as a short-lived cookie so the login and
    // first-run setup forms have a login-CSRF token to send back.
    let sid = null;
    if (session) sid = session.id;
    else if (cookieSession) sid = cookieSession.id;
    else {
      sid = auth.randomId(24);
      const guestExpiry = new Date(Date.now() + 3600000).toISOString();
      res.setHeader('Set-Cookie', auth.sessionCookieValue(secret, sid, guestExpiry));
    }
    state.sessionId = sid;
    state.csrf = auth.csrfFor(secret, sid);

    if (req.method !== 'OPTIONS') {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        const supplied = req.headers[auth.CSRF_HEADER];
        if (!auth.verifyCsrf(secret, state.sessionId || '', supplied)) {
          return sendJson(res, 403, { error: 'Missing or invalid CSRF token.' });
        }
      }
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const params = parseRoute(r.pattern, pathname);
      if (!params) continue;
      try {
        const out = r.handler(req, res, params);
        if (out && typeof out.then === 'function') {
          out.catch((err) => {
            if (!res.headersSent) sendJson(res, 500, { error: err.message || String(err) });
          });
        }
      } catch (err) {
        if (!res.headersSent) sendJson(res, 500, { error: err.message || String(err) });
      }
      return;
    }

    if (req.method === 'GET') {
      if (pathname === '/' || pathname === '/index.html') return serveStatic(res, 'index.html');
      if (pathname === '/app' || pathname === '/app/') return serveStatic(res, 'dashboard.html');
      if (pathname.startsWith('/')) {
        const rel = pathname.replace(/^\/+/, '');
        if (fs.existsSync(path.join(WEB_DIR, rel))) return serveStatic(res, rel);
      }
    }
    sendHtml(res, 404, '<h1>404</h1>');
  }

  const server = http.createServer((req, res) => {
    res.setHeader('X-Frame-Options', 'DENY');
    handle(req, res);
  });

  server.listen(port, host, () => {
    console.log(`[importer] shopify-importer v${VERSION} listening on http://${host}:${port}`);
    console.log(`[importer] data dir: ${path.resolve(dataDir)}`);
    console.log(`[importer] ${setupDone() ? `${userCount(db)} user(s)` : 'no users yet - first visit creates the admin account'}`);
  });

  return server;
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  createApp({
    port: Number(get('--port', '3000')),
    dataDir: get('--data', path.join(process.cwd(), 'data'))
  });
}

module.exports = { createApp };

if (require.main === module) main();
