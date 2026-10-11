'use strict';

/**
 * User, session and connection records.
 *
 * Shopify credentials are held per user so two people sharing the deployment
 * do not share a token. A token is written once and never sent back to the
 * browser; only the last four characters travel over the wire.
 */

const crypto = require('crypto');
const auth = require('./auth');

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    enabled: row.enabled === 1,
    note: row.note || '',
    created_at: row.created_at
  };
}

function listUsers(db) {
  return db.prepare('SELECT * FROM users ORDER BY id').all().map(rowToUser);
}

function getUser(db, id) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return rowToUser(row);
}

function findUserByName(db, username) {
  const row = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(String(username).trim());
  return row || null;
}

function createUser(db, { username, password, role = 'operator', note = '' }) {
  username = String(username || '').trim();
  if (!/^[a-z0-9_.-]{2,40}$/i.test(username)) {
    throw new Error('Username must be 2-40 characters: letters, numbers, dot, dash, underscore.');
  }
  if (role !== 'admin' && role !== 'operator') throw new Error(`Unknown role "${role}".`);
  const problems = auth.policy(password);
  if (problems.length) throw new Error(`Password needs ${problems.join(', ')}.`);
  if (findUserByName(db, username)) throw new Error(`Username "${username}" is taken.`);

  const { salt: s, hash } = auth.hashPassword(password, auth.randomId(8));
  const info = db.prepare(
    `INSERT INTO users (username, salt, pass_hash, role, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(username, s, hash, role, note, auth.nowIso());

  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid)));
}

function setUserEnabled(db, id, enabled) {
  db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
}

function setUserRole(db, id, role) {
  if (role !== 'admin' && role !== 'operator') throw new Error(`Unknown role "${role}".`);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

function resetPassword(db, id, password) {
  const problems = auth.policy(password);
  if (problems.length) throw new Error(`Password needs ${problems.join(', ')}.`);
  const { salt: s, hash } = auth.hashPassword(password, auth.randomId(8));
  db.prepare('UPDATE users SET salt = ?, pass_hash = ? WHERE id = ?').run(s, hash, id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
}

function authenticate(db, username, password) {
  const row = findUserByName(db, username);
  if (!row) return null;
  if (row.enabled !== 1) return null;
  if (!auth.verifyPassword(password, row.salt, row.pass_hash)) return null;
  return rowToUser(row);
}

// --------------------------------------------------------------------- sessions

function createSession(db, userId, ttlDays = auth.SESSION_DAYS) {
  const id = auth.randomId(32);
  const created = auth.nowIso();
  const expires = new Date(Date.now() + ttlDays * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, created, expires);
  return { id, expires_at: expires };
}

function getSession(db, sessionId) {
  if (!sessionId) return null;
  const row = db.prepare(
    `SELECT s.id AS session_id, s.expires_at,
            u.id, u.username, u.role, u.enabled, u.note, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`
  ).get(sessionId);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  if (row.enabled !== 1) return null;
  return {
    id: row.session_id,
    user: rowToUser(row),
    expires_at: row.expires_at
  };
}

function destroySession(db, sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// ---------------------------------------------------------------- connections

function tokenHint(token) {
  const t = String(token || '');
  return t.length > 4 ? `...${t.slice(-4)}` : '****';
}

function getConnection(db, userId) {
  const row = db.prepare('SELECT * FROM connections WHERE user_id = ?').get(userId);
  if (!row) return null;
  return {
    shop: row.shop,
    token: row.token,
    token_hint: row.token_hint,
    label: row.label || '',
    created_at: row.created_at
  };
}

function publicConnection(row) {
  if (!row) return null;
  const { token, ...rest } = row;
  return rest;
}

function saveConnection(db, userId, { shop, token, label = '' }) {
  shop = String(shop || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  token = String(token || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    throw new Error('Shop must look like store.myshopify.com');
  }
  if (!token || token.length < 20) throw new Error('Token looks too short.');
  db.prepare(
    `INSERT INTO connections (user_id, shop, token, token_hint, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET shop = excluded.shop, token = excluded.token,
       token_hint = excluded.token_hint, label = excluded.label, created_at = excluded.created_at`
  ).run(userId, shop, token, tokenHint(token), label, auth.nowIso());
  return getConnection(db, userId);
}

module.exports = {
  rowToUser,
  listUsers,
  getUser,
  findUserByName,
  createUser,
  setUserEnabled,
  setUserRole,
  resetPassword,
  authenticate,
  createSession,
  getSession,
  destroySession,
  getConnection,
  publicConnection,
  saveConnection
};
