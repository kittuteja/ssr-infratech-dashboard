'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const page = document.body.dataset.page || 'inventory';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let currentUser, csrf, initialized = false, accountAction, credentialText = '';
  async function request(path, { method = 'GET', data, ownerKey } = {}) {
    const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(ownerKey ? { 'x-owner-key': ownerKey } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    let result; try { result = await response.json(); } catch { throw new Error('The server is unavailable. Please try again.'); }
    if (!response.ok) {
      if (result.passwordChangeRequired) location.assign('/password');
      if (response.status === 401 && !['login', 'setup'].includes(page)) location.assign('/login');
      const error = new Error(result.error || 'The request could not be completed.'); error.status = response.status; throw error;
    }
    if (result.csrf) { csrf = result.csrf; currentUser = result.user; }
    return result;
  }
  function report(error) { const target = $('#account-error') || $('#storage-warning'); if (target) { target.hidden = false; target.textContent = error.message; } }
  async function busy(form, action) {
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    if ($('#account-error')) $('#account-error').textContent = '';
    try { await action(Object.fromEntries(new FormData(form))); } catch (error) { report(error); } finally { button.disabled = false; }
  }
  function checkConfirmation(data) { if (data.password !== data.confirmPassword) throw new Error('The new passwords do not match.'); }
  async function logout() { try { if (!csrf) await request('/api/auth/me'); await request('/api/auth/logout', { method: 'POST', data: {} }); location.assign('/login'); } catch (error) { report(error); } }
  document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', logout));
  document.querySelectorAll('[data-show-password]').forEach(box => box.addEventListener('change', () => { box.closest('form').elements.password.type = box.checked ? 'text' : 'password'; }));
  const formatTime = value => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : 'Never';
  async function loadUsers() {
    const [data, history] = await Promise.all([request('/api/users'), request('/api/users/audit')]);
    $('#user-count').textContent = `${data.users.length} account${data.users.length === 1 ? '' : 's'}`;
    $('#user-rows').innerHTML = data.users.map(user => `<tr><td><strong>${esc(user.name)}</strong><small>${esc(user.username)}</small></td><td>${user.role === 'admin' ? 'Admin' : 'Staff'}</td><td><span class="user-state ${user.active ? '' : 'inactive'}">${!user.active ? 'Inactive' : user.mustChangePassword ? 'Password change needed' : 'Active'}</span></td><td>${esc(formatTime(user.lastLogin))}</td><td>${user.id === 'owner' ? 'Owner (protected)' : user.id === currentUser.id ? 'Your account' : `<div class="user-actions"><button class="secondary" data-user-action="reset" data-id="${esc(user.id)}">Reset password</button><button class="secondary" data-user-action="active" data-id="${esc(user.id)}">${user.active ? 'Deactivate' : 'Activate'}</button><button class="secondary" data-user-action="role" data-id="${esc(user.id)}">Make ${user.role === 'admin' ? 'staff' : 'admin'}</button></div>`}</td></tr>`).join('');
    $('#account-audit').innerHTML = history.events.map(event => `<div class="audit-entry">${esc(event.action)} · ${esc(event.name)} (${esc(event.username)})<small>By ${esc(event.actor)} · ${esc(formatTime(event.recorded_at))}</small></div>`).join('') || '<p>No account changes yet.</p>';
    $('#user-rows').querySelectorAll('[data-user-action]').forEach(button => button.addEventListener('click', () => {
      const user = data.users.find(item => item.id === button.dataset.id), action = button.dataset.userAction;
      $('#confirm-message').textContent = action === 'reset' ? `Reset ${user.name}’s password? Their current password and sessions will stop working. A new temporary password will be shown.` : action === 'active' ? `${user.active ? 'Deactivate' : 'Activate'} ${user.name}’s account? Existing sessions will be signed out.` : `Change ${user.name} to ${user.role === 'admin' ? 'Staff' : 'Admin'}? Admins can manage staff accounts and view and edit all financial records. Existing sessions will be signed out.`;
      $('#confirm-error').textContent = '';
      accountAction = async () => action === 'reset' ? request(`/api/users/${user.id}/reset-password`, { method: 'POST', data: {} }) : request(`/api/users/${user.id}`, { method: 'PATCH', data: { role: action === 'role' ? (user.role === 'admin' ? 'staff' : 'admin') : user.role, active: action === 'active' ? !user.active : user.active } });
      $('#confirm-dialog').showModal();
    }));
  }
  function showCredentials(result) {
    const url = location.origin + '/login';
    $('#credential-url').textContent = url; $('#credential-username').textContent = result.user.username; $('#credential-password').textContent = result.temporaryPassword;
    $('#credential-error').textContent = ''; credentialText = `SSR INFRATECH — Development\nSign in: ${url}\nUsername: ${result.user.username}\nTemporary password: ${result.temporaryPassword}\nExpires in 24 hours. Choose your own password after sign-in.`;
    $('#credential-dialog').showModal();
  }
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $('#credential-dialog')?.addEventListener('close', () => { credentialText = ''; $('#credential-password').textContent = ''; });
  $('#copy-credentials')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(credentialText); $('#credential-error').textContent = 'Copied. Share directly with the account holder.'; } catch { $('#credential-error').textContent = 'Copy is unavailable here. Select and copy the details above.'; } });
  $('#confirm-account-action')?.addEventListener('click', async event => {
    event.target.disabled = true;
    try { const result = await accountAction(); $('#confirm-dialog').close(); if (result.temporaryPassword) showCredentials(result); await loadUsers(); } catch (error) { $('#confirm-error').textContent = error.message; } finally { event.target.disabled = false; }
  });
  $('#refresh-users')?.addEventListener('click', async event => { event.target.disabled = true; try { await loadUsers(); } catch (error) { report(error); } finally { event.target.disabled = false; } });
  $('#login-form')?.addEventListener('submit', event => { event.preventDefault(); busy(event.target, async data => { const result = await request('/api/auth/login', { method: 'POST', data }); event.target.reset(); location.assign(result.user.mustChangePassword ? '/password' : '/'); }); });
  $('#password-form')?.addEventListener('submit', event => { event.preventDefault(); busy(event.target, async data => { checkConfirmation(data); await request('/api/auth/password', { method: 'POST', data }); event.target.reset(); location.assign('/'); }); });
  $('#setup-form')?.addEventListener('submit', event => { event.preventDefault(); busy(event.target, async ({ ownerKey, ...data }) => { checkConfirmation(data); await request(initialized ? '/api/auth/owner-recovery' : '/api/auth/setup', { method: 'POST', data, ownerKey }); event.target.reset(); location.assign('/users'); }); });
  $('#create-user-form')?.addEventListener('submit', event => { event.preventDefault(); busy(event.target, async data => { const result = await request('/api/users', { method: 'POST', data }); event.target.reset(); showCredentials(result); await loadUsers(); }); });
  const ready = (async () => {
    if (page === 'login') return;
    if (page === 'setup') {
      try {
        const state = await request('/api/auth/setup-status'); initialized = state.initialized;
        if (!(initialized ? state.recoveryEnabled : state.setupEnabled)) {
          $('#setup-title').textContent = initialized ? 'Administrator already set up' : 'Administrator setup is disabled';
          $('#setup-description').textContent = initialized ? 'Sign in with your SSR credentials. Contact the deployment owner if you need to recover access.' : 'Ask the deployment owner to enable administrator setup with a private setup key.';
          return;
        }
        $('#setup-form').hidden = false;
        $('#setup-description').textContent = initialized ? 'Set a new owner password. Your existing sessions will be signed out.' : 'Create the first SSR administrator, then add your staff accounts. Staff sign in with SSR credentials.';
        if (initialized) { $('#setup-title').textContent = 'Recover owner access'; $('#setup-submit').textContent = 'Set new owner password'; $('#owner-key-label').textContent = 'Owner recovery key'; $('#owner-key-help').textContent = 'Enter the private recovery key provided by the deployment owner.'; $('#setup-profile').hidden = true; $('#setup-form').elements.name.disabled = true; $('#setup-form').elements.username.disabled = true; }
      } catch (error) { report(error); }
      return;
    }
    const state = await request('/api/auth/me');
    if (state.user.mustChangePassword && page !== 'password') { location.assign('/password'); return; }
    if (page === 'password') { $('#back-inventory').hidden = state.user.mustChangePassword; if (state.user.mustChangePassword) $('#password-description').textContent = 'You are using a temporary password. Choose your own password to access the dashboard.'; }
    if (page === 'users') { if (state.user.role !== 'admin') { location.assign('/'); return; } await loadUsers(); }
    if (page === 'inventory') {
      const signout = $('.signout'); if (signout) { signout.href = '/login'; signout.removeAttribute('target'); signout.addEventListener('click', event => { event.preventDefault(); logout(); }); }
      const signIn = $('#signin-link'); if (signIn) signIn.href = '/login';
      const links = document.createElement('div'); links.className = 'account-links';
      const passwordLink = document.createElement('a'); passwordLink.href = '/password'; passwordLink.textContent = 'My password'; links.append(passwordLink);
      if (state.user.role === 'admin') { const finance = document.createElement('a'); finance.href = '/people-payments'; finance.textContent = 'People & Payments'; links.append(finance); const staff = document.createElement('a'); staff.href = '/users'; staff.textContent = 'Staff accounts'; links.prepend(staff); }
      $('.sidebar nav')?.append(links);
      const badge = $('.demo-pill'); if (badge) badge.textContent = 'DEVELOPMENT WORKSPACE';
    }
  })();
  window.SSR = { ready, get csrf() { return csrf; }, get user() { return currentUser; } };
  ready.catch(report);
})();
