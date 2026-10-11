/* Login and first-run setup screen. */
(function () {
  'use strict';

  const { App, el } = window;
  const { $ } = App;

  async function boot() {
    let state;
    try {
      state = await App.bootstrap();
    } catch (err) {
      const card = $('#card');
      card.appendChild(el('div', { class: 'msg err show mt' }, 'Cannot reach the importer server: ' + App.esc(err.message)));
      return;
    }

    if (state.csrf) App.setCsrf(state.csrf);
    if (state.me) { window.location.replace('/app'); return; }

    const setupForm = $('#setupForm');
    const loginForm = $('#loginForm');

    if (!state.setupDone) {
      setupForm.classList.remove('hidden');
    } else {
      loginForm.classList.remove('hidden');
      $('#lgUser').focus();
    }

    $('#suBtn').addEventListener('click', doSetup);
    $('#lgBtn').addEventListener('click', doLogin);
    for (const id of ['suPass2', 'lgPass']) {
      $('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.form.dispatchEvent(new Event('submit')); });
    }
    $('#lgUser').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('#lgPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('#suPass2').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSetup(); });
  }

  function validate(password, confirm) {
    const p = String(password || '');
    const problems = [];
    if (p.length < 10) problems.push('at least 10 characters');
    if (!/[a-z]/.test(p) || !/[A-Z]/.test(p)) problems.push('upper and lower case');
    if (!/[0-9]/.test(p)) problems.push('a digit');
    if (confirm !== undefined && confirm !== null && String(confirm) !== p) problems.push('the two passwords do not match');
    if (problems.length) return 'Password needs ' + problems.join(', ') + '.';
    return '';
  }

  async function doSetup() {
    const btn = $('#suBtn');
    const msg = $('#suMsg');
    App.clearFlash(msg);
    const username = $('#suUser').value.trim();
    const password = $('#suPass').value;
    const confirm = $('#suPass2').value;
    if (!username) return App.flash(msg, 'Choose a username.', 'err');
    const bad = validate(password, confirm);
    if (bad) return App.flash(msg, bad, 'err');

    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      const out = await App.setup(username, password);
      if (out.csrf) App.setCsrf(out.csrf);
      App.flash(msg, 'Account created. Redirecting…', 'ok');
      setTimeout(() => window.location.replace('/app'), 450);
    } catch (err) {
      App.flash(msg, err.message, 'err');
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  }

  async function doLogin() {
    const btn = $('#lgBtn');
    const msg = $('#lgMsg');
    App.clearFlash(msg);
    const username = $('#lgUser').value.trim();
    const password = $('#lgPass').value;
    if (!username || !password) return App.flash(msg, 'Enter both a username and a password.', 'err');

    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const out = await App.login(username, password);
      if (out.csrf) App.setCsrf(out.csrf);
      App.flash(msg, 'Signed in. Redirecting…', 'ok');
      setTimeout(() => window.location.replace('/app'), 300);
    } catch (err) {
      App.flash(msg, err.message, 'err');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
