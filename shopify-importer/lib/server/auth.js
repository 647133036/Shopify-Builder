'use strict';

/**
 * Passwords, sessions and CSRF.
 *
 * Passwords: scrypt (built into Node's crypto) with a per-user 16-byte salt.
 * Sessions: a random id stored in the database, presented in a cookie whose
 * value is `id:expires:hmac` so the server can detect a tampered cookie before
 * it ever touches the database.
 * CSRF: a per-session HMAC, required as the x-csrf-token header on every
 * mutating request.
 */

const crypto = require('crypto');

const SESSION_DAYS = 14;
const COOKIE_NAME = 'importer_session';
const CSRF_HEADER = 'x-csrf-token';
const ALGO = { N: 16384, r: 8, p: 1, keylen: 64 };

const nowIso = () => new Date().toISOString();
const parseTs = (s) => Date.parse(s);

function salt() {
  return crypto.randomBytes(16).toString('hex');
}

function randomId(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function timingEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// ------------------------------------------------------------------- passwords

function hashPassword(password, customSalt) {
  const s = customSalt || salt();
  const hash = crypto.scryptSync(String(password), Buffer.from(s, 'hex'), ALGO.keylen, ALGO).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, saltHex, expectedHash) {
  const { hash } = hashPassword(password, saltHex);
  return timingEqual(hash, expectedHash);
}

function policy(password) {
  const p = String(password);
  const problems = [];
  if (p.length < 10) problems.push('at least 10 characters');
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p)) problems.push('upper and lower case');
  if (!/[0-9]/.test(p)) problems.push('a digit');
  return problems;
}

// -------------------------------------------------------------- session cookie

/**
 * Cookie format: `<sessionId>.<expiresEpochMs>.<hmac>`.
 *
 * The timestamp is epoch milliseconds rather than an ISO string because ISO
 * 8601 contains a '.' and the cookie is dot-delimited.
 */
function signSession(secret, sessionId, expiresMs) {
  const mac = hmac(secret, `${sessionId}.${expiresMs}`);
  return `${sessionId}.${expiresMs}.${mac}`;
}

function verifySessionCookie(secret, cookie) {
  if (!cookie || typeof cookie !== 'string') return null;
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;
  const [id, expiresMs, mac] = parts;
  const n = Number(expiresMs);
  if (!/^\d+$/.test(expiresMs) || !Number.isFinite(n)) return null;
  if (!timingEqual(mac, hmac(secret, `${id}.${expiresMs}`))) return null;
  if (n <= Date.now()) return null;
  return { id, expiresMs: n };
}

function sessionCookieValue(secret, sessionId, expires) {
  const ms = typeof expires === 'number' ? expires : parseTs(expires);
  return `${COOKIE_NAME}=${signSession(secret, sessionId, ms)}; ` +
    `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ----------------------------------------------------------------------- csrf

function csrfFor(secret, sessionId) {
  return hmac(secret, `csrf.${sessionId}`);
}

function verifyCsrf(secret, sessionId, provided) {
  if (!sessionId || !provided) return false;
  return timingEqual(csrfFor(secret, sessionId), String(provided));
}

module.exports = {
  SESSION_DAYS,
  COOKIE_NAME,
  CSRF_HEADER,
  hashPassword,
  verifyPassword,
  policy,
  signSession,
  verifySessionCookie,
  sessionCookieValue,
  clearSessionCookie,
  parseCookies,
  csrfFor,
  verifyCsrf,
  randomId,
  nowIso
};
