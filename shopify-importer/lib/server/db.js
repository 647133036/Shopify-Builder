'use strict';

/**
 * SQLite storage for the hosted importer.
 *
 * Uses node:sqlite (built into Node 22+, no dependency). The database is a
 * single file in the data directory alongside the signing secret, so the whole
 * deployment is one folder.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT NOT NULL UNIQUE,
  salt      TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','operator')),
  enabled   INTEGER NOT NULL DEFAULT 1,
  note      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS connections (
  user_id    INTEGER PRIMARY KEY,
  shop       TEXT NOT NULL,
  token      TEXT NOT NULL,
  token_hint TEXT NOT NULL DEFAULT '',
  label      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS imports (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  filename    TEXT NOT NULL DEFAULT '',
  mode        TEXT NOT NULL DEFAULT 'dry-run',
  status      TEXT NOT NULL DEFAULT 'queued',
  stage       TEXT NOT NULL DEFAULT '',
  progress    INTEGER NOT NULL DEFAULT 0,
  stats       TEXT NOT NULL DEFAULT '{}',
  outcome     TEXT NOT NULL DEFAULT '{}',
  error       TEXT NOT NULL DEFAULT '',
  rows_in     INTEGER NOT NULL DEFAULT 0,
  products    INTEGER NOT NULL DEFAULT 0,
  variants    INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_imports_user ON imports(user_id, started_at);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Open (and migrate) the database in `dir`. Creates the directory and the
 * signing secret file if they do not exist.
 *
 * @param {string} dir
 * @returns {{ db: DatabaseSync, dir: string, secret: string }}
 */
function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });

  const secretFile = path.join(dir, 'secret.key');
  let secret = process.env.IMPORTER_SECRET || '';
  if (!secret) {
    if (fs.existsSync(secretFile)) {
      secret = fs.readFileSync(secretFile, 'utf8').trim();
    } else {
      secret = crypto.randomBytes(48).toString('hex');
      fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    }
  }
  if (!secret) throw new Error(`No usable signing secret found in ${secretFile}`);

  const db = new DatabaseSync(path.join(dir, 'app.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  return { db, dir, secret };
}

function userCount(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  return Number(row.n);
}

module.exports = { openDb, userCount, newId, nowIso, SCHEMA };
