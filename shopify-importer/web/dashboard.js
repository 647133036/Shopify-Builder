/* Dashboard: connection, import wizard, history, users. */
(function () {
  'use strict';

  const App = window.App;
  const { $, el, clear, esc } = App;

  let me = null;
  let currentFile = null;
  let currentPreview = null;
  let pollTimer = null;

  // ------------------------------------------------------------------- session

  async function boot() {
    try {
      const b = await App.bootstrap();
      if (b.csrf) App.setCsrf(b.csrf);
      if (!b.me) { window.location.replace('/'); return; }
      me = b.me;
    } catch (err) {
      document.body.appendChild(el('div', { class: 'msg err show', style: 'margin:16px' }, 'Cannot reach the server: ' + esc(err.message)));
      return;
    }
    renderWho();
    wireEvents();
    loadHistory();
    if (me.role === 'admin') {
      $('#usersPanel').classList.remove('hidden');
      loadUsers();
    }
  }

  function renderWho() {
    $('#whoName').textContent = me.username;
    $('#whoRole').textContent = me.role;
  }

  async function doLogout() {
    try { await App.logout(); } catch (e) { /* keep going */ }
    window.location.replace('/');
  }

  // ------------------------------------------------------------------ connection

  async function loadConnection() {
    try {
      const out = await App.me();
      me = out.user || me;
      if (out.csrf) App.setCsrf(out.csrf);
      const c = out.connection;
      if (c) {
        $('#shopInput').value = c.shop;
        $('#connBadge').className = 'badge dot ok';
        $('#connBadge').textContent = c.shop;
        $('#connInfo').textContent = 'Stored: ' + c.token_hint + ' · saved ' + App.fmtTime(c.created_at);
        App.flash($('#connMsg'), 'Connection loaded from this server.', 'info', 0);
        $('#connMsg').className = 'msg show info';
      }
    } catch (err) {
      if (err.status === 401) { window.location.replace('/'); }
    }
  }

  function clearConnMsg() {
    $('#connMsg').className = 'msg';
    $('#connMsg').textContent = '';
  }

  async function testConnection() {
    clearConnMsg();
    const btn = $('#testBtn');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    try {
      const out = await App.testConnection({ shop: $('#shopInput').value.trim(), token: $('#tokenInput').value.trim() });
      const bits = ['Store: ' + out.shop];
      if (out.plan) bits.push('plan ' + out.plan);
      if (out.currency) bits.push(out.currency);
      if (out.email) bits.push(out.email);
      App.flash($('#connMsg'), bits.join(' · '), 'ok', 0);
    } catch (err) {
      const extra = err.body && err.body.status ? ` (HTTP ${err.body.status})` : '';
      App.flash($('#connMsg'), 'Connection failed' + extra + ': ' + err.message, 'err', 0);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test connection';
    }
  }

  async function saveConnection() {
    clearConnMsg();
    const shop = $('#shopInput').value.trim();
    const token = $('#tokenInput').value.trim();
    if (!shop || !token) {
      return App.flash($('#connMsg'), 'Enter both a store and a token.', 'err', 0);
    }
    const btn = $('#saveConnBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const out = await App.saveConnection({ shop, token });
      const c = out.connection;
      $('#connBadge').className = 'badge dot ok';
      $('#connBadge').textContent = c.shop;
      $('#connInfo').textContent = 'Stored: ' + c.token_hint + ' · saved ' + App.fmtTime(c.created_at);
      $('#tokenInput').value = '';
      $('#tokenInput').placeholder = 'Stored: ' + c.token_hint;
      App.flash($('#connMsg'), 'Saved. You can clear the token field.', 'ok', 0);
    } catch (err) {
      App.flash($('#connMsg'), err.message, 'err', 0);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save connection';
    }
  }

  // -------------------------------------------------------------------- imports

  function wireEvents() {
    const drop = $('#drop');
    const fileInput = $('#fileInput');

    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

    for (const ev of ['dragenter', 'dragover']) {
      drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('hot'); });
    }
    for (const ev of ['dragleave', 'drop']) {
      drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('hot'); });
    }
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    $('#testBtn').addEventListener('click', testConnection);
    $('#saveConnBtn').addEventListener('click', saveConnection);
    $('#logoutBtn').addEventListener('click', doLogout);
    $('#dryRunBtn').addEventListener('click', () => runImport('dry-run'));
    $('#liveBtn').addEventListener('click', () => runImport('live'));
    $('#refreshHistoryBtn').addEventListener('click', loadHistory);
    $('#refreshUsersBtn').addEventListener('click', loadUsers);
    $('#addUserBtn').addEventListener('click', addUser);
    $('#genPassBtn').addEventListener('click', () => {
      $('#nuPass').value = suggestPassword();
      $('#nuPass').focus();
    });
    $('#clearPreviewBtn').addEventListener('click', () => {
      currentFile = null;
      currentPreview = null;
      $('#preview').classList.add('hidden');
      $('#drop').classList.remove('hidden');
    });
    $('#dlProductsBtn').addEventListener('click', () => {
      if (currentPreview && currentPreview.productsCsv) {
        App.download((currentPreview.filename || 'upload.csv').replace(/\.[^.]+$/, '') + '.products.csv', currentPreview.productsCsv, 'text/csv');
      }
    });
  }

  function suggestPassword() {
    const words = ['shop', 'feed', 'stock', 'line', 'crate', 'hatch', 'drift', 'ember'];
    const pick = () => words[Math.floor(Math.random() * words.length)];
    return pick() + '-' + pick() + '-' + Math.floor(1000 + Math.random() * 9000) + '!';
  }

  async function handleFile(file) {
    clearConnMsg();
    if (!/\.csv$|\.json$/i.test(file.name)) {
      return App.flash($('#dropMsg'), 'Upload a .csv or .json file.', 'err', 0);
    }
    currentFile = file;
    App.flash($('#dropMsg'), 'Normalising ' + file.name + '…', 'info', 0);
    try {
      const preview = await App.normalizeFile(file);
      currentPreview = preview;
      renderPreview(preview);
      $('#dropMsg').className = 'msg';
    } catch (err) {
      App.flash($('#dropMsg'), err.message, 'err', 0);
    }
  }

  function renderPreview(p) {
    $('#preview').classList.remove('hidden');
    $('#previewName').textContent = p.filename || currentFile.name;
    $('#previewRows').textContent = p.rowCount + ' input rows';

    const s = p.stats || {};
    const tiles = [
      ['Input rows', s.inputRows || p.rowCount, ''],
      ['Products', s.products, 'ok'],
      ['Variants', s.variants, 'ok'],
      ['Images', s.images, ''],
      ['Duplicate rows', s.droppedDuplicates, s.droppedDuplicates ? 'warn' : ''],
      ['Malformed rows', s.droppedMalformed, s.droppedMalformed ? 'err' : '']
    ];
    clear($('#statGrid'));
    for (const [label, value, cls] of tiles) {
      $('#statGrid').appendChild(el('div', { class: 'tile ' + cls }, el('div', { class: 'n' }, String(value || 0)), el('div', { class: 'l' }, label)));
    }

    clear($('#mapBody'));
    const map = p.fieldMap || {};
    const entries = Object.entries(map);
    if (!entries.length) {
      $('#mapBody').appendChild(el('tr', {}, el('td', { colspan: '2', class: 'muted' }, 'No columns were recognised.')));
    } else {
      for (const [canon, source] of entries) {
        $('#mapBody').appendChild(el('tr', {}, el('td', { class: 'mono' }, esc(canon)), el('td', { class: 'mono' }, esc(source))));
      }
    }

    clear($('#warnBody'));
    const warns = p.errors || [];
    if (!warns.length) {
      $('#warnBody').appendChild(el('tr', {}, el('td', { colspan: '3', class: 'muted ok' }, 'No warnings. Every row parsed cleanly.')));
    } else {
      for (const w of warns.slice(0, 200)) {
        const cls = w.level === 'error' || String(w.code || '').startsWith('E_') ? 'error' : 'warn';
        $('#warnBody').appendChild(el('tr', {},
          el('td', { class: 'mono' }, String(w.line || '')),
          el('td', { class: 'mono' }, esc(w.code || '')),
          el('td', {}, el('span', { class: cls }, esc(w.message || '')))));
      }
    }

    clear($('#sampleBody'));
    const rows = p.products || [];
    if (!rows.length) {
      $('#sampleBody').appendChild(el('tr', {}, el('td', { colspan: '8', class: 'muted' }, 'No valid variants.')));
    } else {
      for (const r of rows) {
        $('#sampleBody').appendChild(el('tr', {},
          el('td', { class: 'mono' }, esc(r.handle)),
          el('td', {}, esc(r.title)),
          el('td', { class: 'mono' }, esc(r.variant_sku || '')),
          el('td', { class: 'mono' }, esc(r.variant_price || '')),
          el('td', {}, esc(r.option1_value || '')),
          el('td', {}, esc(r.option2_value || '')),
          el('td', {}, esc(r.option3_value || '')),
          el('td', { class: 'mono' }, esc(r.variant_weight || ''))));
      }
    }
  }

  async function runImport(mode) {
    if (!currentFile) {
      return App.flash($('#runMsg'), 'Choose a file first.', 'err', 0);
    }
    if (mode === 'live') {
      if (!confirm('Write to Shopify with "' + currentFile.name + '"? This creates or updates products in your store.')) return;
    }
    App.clearFlash($('#runMsg'));
    $('#outcome').classList.add('hidden');
    $('#runBox').classList.remove('hidden');
    setRun(0, 'Submitting…');
    $('#dryRunBtn').disabled = true;
    $('#liveBtn').disabled = true;

    try {
      const opts = {
        mode,
        processImages: $('#optProcessImages').checked ? 'true' : 'false',
        skipDuplicates: $('#optSkipDuplicates').checked ? 'true' : 'false'
      };
      const out = await App.startImport(currentFile, opts);
      if (out.error && out.id) {
        App.flash($('#runMsg'), out.error, 'err', 0);
        $('#runBox').classList.add('hidden');
        $('#dryRunBtn').disabled = false;
        $('#liveBtn').disabled = false;
        return;
      }
      pollJob(out.id, mode);
    } catch (err) {
      App.flash($('#runMsg'), err.message, 'err', 0);
      $('#runBox').classList.add('hidden');
      $('#dryRunBtn').disabled = false;
      $('#liveBtn').disabled = false;
    }
  }

  function setRun(pct, stage) {
    $('#runBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
    $('#runPct').textContent = Math.round(pct) + '%';
    if (stage) $('#runStage').textContent = stage;
  }

  function pollJob(id, mode) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      let j;
      try { j = await App.job(id); } catch (err) { return; }
      setRun(j.progress || 0, j.stage || j.status);
      if (j.status === 'done' || j.status === 'failed' || j.status === 'done-with-errors') {
        clearInterval(pollTimer);
        pollTimer = null;
        renderOutcome(j, mode);
        $('#dryRunBtn').disabled = false;
        $('#liveBtn').disabled = false;
        loadHistory();
      }
    }, 1200);
  }

  function renderOutcome(j, mode) {
    if (j.error) App.flash($('#runMsg'), j.error, 'err', 0);
    else if (j.status === 'done') App.flash($('#runMsg'), mode === 'live' ? 'Written to Shopify.' : 'Dry run finished. Nothing was sent to Shopify.', 'ok', 0);
    else if (j.status === 'done-with-errors') App.flash($('#runMsg'), 'Finished with errors on some products. See the table below.', 'info', 0);

    clear($('#outcomeStats'));
    const o = j.outcome || {};
    const counts = o.counts || {};
    if (mode === 'dry-run' || (o.dryRun && j.status === 'done' && !counts.created && !counts.updated)) {
      const s = j.stats || {};
      const tiles = [
        ['Products built', s.products, 'ok'],
        ['Variants built', s.variants, 'ok'],
        ['Duplicate rows', s.droppedDuplicates, s.droppedDuplicates ? 'warn' : ''],
        ['Malformed rows', s.droppedMalformed, s.droppedMalformed ? 'err' : '']
      ];
      for (const [label, value, cls] of tiles) {
        $('#outcomeStats').appendChild(el('div', { class: 'tile ' + cls }, el('div', { class: 'n' }, String(value || 0)), el('div', { class: 'l' }, label)));
      }
    } else {
      const tiles = [
        ['Created', counts.created, counts.created ? 'ok' : ''],
        ['Updated', counts.updated, counts.updated ? 'ok' : ''],
        ['Skipped', counts.skipped, counts.skipped ? 'warn' : ''],
        ['Failed', counts.failed, counts.failed ? 'err' : '']
      ];
      for (const [label, value, cls] of tiles) {
        $('#outcomeStats').appendChild(el('div', { class: 'tile ' + cls }, el('div', { class: 'n' }, String(value || 0)), el('div', { class: 'l' }, label)));
      }
    }

    clear($('#outcomeBody'));
    const records = o.records || [];
    if (!records.length) {
      $('#outcomeBody').appendChild(el('tr', {}, el('td', { colspan: '6', class: 'muted' }, 'Dry run recorded aggregate counts. Re-run with "Write to Shopify" to see per-product results.')));
    } else {
      for (const r of records) {
        $('#outcomeBody').appendChild(el('tr', {},
          el('td', { class: 'mono' }, esc(r.handle)),
          el('td', {}, esc(r.title || '')),
          el('td', {}, el('span', { class: 'tag' }, esc(r.action || ''))),
          el('td', { class: 'mono' }, r.id ? String(r.id) : '—'),
          el('td', { class: 'mono' }, String(r.images == null ? '—' : r.images)),
          el('td', {}, r.error ? el('span', { class: 'error' }, esc(r.error)) : el('span', { class: 'muted' }, '—'))));
      }
    }

    $('#outcome').classList.remove('hidden');
  }

  // --------------------------------------------------------------------- history

  async function loadHistory() {
    let out;
    try { out = await App.listImports(); } catch (err) { return; }
    clear($('#historyBody'));
    const items = out.imports || [];
    if (!items.length) {
      $('#historyBody').appendChild(el('tr', {}, el('td', { colspan: '7', class: 'muted' }, 'No imports yet.')));
      return;
    }
    for (const j of items) {
      $('#historyBody').appendChild(el('tr', {},
        el('td', { class: 'nowrap' }, App.fmtTime(j.started_at)),
        el('td', { class: 'clip' }, esc(j.filename || '—')),
        el('td', {}, el('span', { class: 'tag' }, esc(j.mode))),
        el('td', {}, App.statusBadge(j.status)),
        el('td', { class: 'mono' }, String(j.products || 0)),
        el('td', { class: 'mono' }, String(j.variants || 0)),
        el('td', { class: 'mono' }, j.finished_at ? duration(j.started_at, j.finished_at) : '—')));
    }
  }

  function duration(a, b) {
    const ms = Date.parse(b) - Date.parse(a);
    if (isNaN(ms) || ms < 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  // ---------------------------------------------------------------------- users

  async function loadUsers() {
    let out;
    try { out = await App.listUsers(); } catch (err) { return; }
    clear($('#usersBody'));
    for (const u of out.users || []) {
      const self = u.id === me.id;
      const cell = el('td', { class: 'row tight' });
      const toggle = el('button', {
        class: 'btn ghost sm',
        text: u.enabled ? 'Disable' : 'Enable',
        onclick: async () => {
          try { await App.updateUser(u.id, { enabled: !u.enabled }); loadUsers(); }
          catch (err) { App.flash($('#userMsg'), err.message, 'err', 0); }
        }
      });
      cell.appendChild(toggle);
      if (!self) {
        const reset = el('button', {
          class: 'btn ghost sm',
          text: 'Reset password',
          onclick: async () => {
            const p = window.prompt('New password for ' + u.username + ' (min 10 chars, upper+lower+digit):');
            if (!p) return;
            try { await App.updateUser(u.id, { password: p }); App.flash($('#userMsg'), 'Password updated for ' + u.username + '.', 'ok', 5000); }
            catch (err) { App.flash($('#userMsg'), err.message, 'err', 0); }
          }
        });
        cell.appendChild(reset);
      }
      $('#usersBody').appendChild(el('tr', {},
        el('td', {}, el('b', {}, esc(u.username)), self ? el('span', { class: 'muted small' }, ' (you)') : null),
        el('td', {}, el('span', { class: 'tag' }, esc(u.role))),
        el('td', {}, App.statusBadge(u.enabled ? 'active' : 'disabled')),
        cell));
    }
  }

  async function addUser() {
    const msg = $('#userMsg');
    App.clearFlash(msg);
    const username = $('#nuUser').value.trim();
    const password = $('#nuPass').value;
    if (!username || !password) return App.flash(msg, 'Enter a username and password.', 'err', 0);
    const btn = $('#addUserBtn');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
      await App.createUser({ username, password, role: $('#nuRole').value, note: '' });
      App.flash(msg, 'Added ' + username + '.', 'ok', 4000);
      $('#nuUser').value = '';
      $('#nuPass').value = '';
      loadUsers();
    } catch (err) {
      App.flash(msg, err.message, 'err', 0);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add user';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    boot().then(loadConnection);
  });
})();
