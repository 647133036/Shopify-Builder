/* Shared API client and helpers for the importer web UI. */
(function (global) {
  'use strict';

  let csrf = '';

  function setCsrf(token) { if (token) csrf = token; }

  function getCsrf() { return csrf; }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (opts.method && opts.method !== 'GET' && opts.method !== 'HEAD') {
      headers['x-csrf-token'] = csrf;
    }
    let body = opts.body;
    if (body && typeof body !== 'string' && !(body instanceof FormData) && !(body instanceof Blob)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(path, { method: opts.method || 'GET', headers, body });
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = { error: text || res.statusText }; }
    if (!res.ok) {
      const err = new Error((json && (json.error || json.message)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  function bootstrap() { return api('/api/bootstrap'); }
  function me() { return api('/api/me'); }
  function login(username, password) { return api('/api/login', { method: 'POST', body: { username, password } }); }
  function setup(username, password) { return api('/api/setup', { method: 'POST', body: { username, password } }); }
  function logout() { return api('/api/logout', { method: 'POST', body: {} }); }

  function saveConnection(payload) { return api('/api/connection', { method: 'POST', body: payload }); }
  function testConnection(payload) { return api('/api/connection/test', { method: 'POST', body: payload }); }

  function normalizeFile(file, extra) {
    const fd = new FormData();
    fd.append('file', file);
    if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return api('/api/normalize', { method: 'POST', body: fd });
  }

  function startImport(file, opts) {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(opts || {})) fd.append(k, v);
    return api('/api/import', { method: 'POST', body: fd });
  }

  function job(id) { return api('/api/import/' + encodeURIComponent(id)); }
  function listImports() { return api('/api/imports'); }
  function listUsers() { return api('/api/users'); }
  function createUser(payload) { return api('/api/users', { method: 'POST', body: payload }); }
  function updateUser(id, payload) { return api('/api/users/' + encodeURIComponent(id), { method: 'POST', body: payload }); }

  // ---- tiny DOM helpers ----

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v);
      }
    }
    for (const kid of kids) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function flash(node, text, kind, ms) {
    if (!node) return;
    node.textContent = text || '';
    node.className = 'msg show ' + (kind || 'info');
    if (text && ms) setTimeout(() => { node.className = 'msg'; }, ms);
  }

  function clearFlash(node) { if (node) { node.className = 'msg'; node.textContent = ''; } }

  function fmtBytes(n) {
    if (!n && n !== 0) return '';
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      year: sameYear ? undefined : 'numeric'
    });
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function statusBadge(status) {
    const cls = status === 'done' ? 'ok' : status === 'failed' ? 'err' : status === 'done-with-errors' ? 'warn' : '';
    return el('span', { class: 'badge dot ' + cls }, status);
  }

  global.App = {
    api, bootstrap, me, login, setup, logout,
    saveConnection, testConnection,
    normalizeFile, startImport, job, listImports,
    listUsers, createUser, updateUser,
    setCsrf, getCsrf,
    $, $$, el, clear, flash, clearFlash,
    fmtBytes, fmtTime, esc, download, statusBadge
  };
})(window);
