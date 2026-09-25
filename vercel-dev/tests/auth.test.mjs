import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { authApi, digest, hashPassword } from '../server/auth.mjs';
import { api } from '../server/api.mjs';
import { localDatabase } from '../scripts/sqlite-d1.mjs';
const origin = 'https://ssr.example';
const ownerHeaders = { 'x-owner-key': '1'.repeat(64) };
const recoveryHeaders = { 'x-owner-key': '2'.repeat(64) };
const ownerPassword = 'A unique owner test phrase 846!';
const newPassword = 'A unique staff test phrase 952!';
function harness() {
  const DB = localDatabase(), env = { DB, OWNER_SETUP_KEY: '1'.repeat(64), OWNER_RECOVERY_KEY: '2'.repeat(64) };
  function req(path, method = 'GET', data, headers = {}) { return new Request(origin + path, { method, headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) }); }
  const call = (path, method, data, headers) => authApi(req(path, method, data, headers), env);
  async function signIn(username, password) { return credentials(await call('/api/auth/login', 'POST', { username, password })); }
  async function owner() { return credentials(await call('/api/auth/setup', 'POST', { username: 'owner', name: 'Owner', password: ownerPassword }, ownerHeaders)); }
  return { DB, env, call, req, signIn, owner };
}
async function credentials(response) {
  const data = await response.json(); assert.equal(response.status, 200, data.error);
  return { cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': data.csrf };
}
async function createStaff(h, owner, username = 'site-staff') {
  const response = await h.call('/api/users', 'POST', { username, name: 'Site Staff', role: 'staff' }, owner);
  assert.equal(response.status, 201); return response.json();
}
test('password hashing matches standard scrypt and uses fresh salts', async () => {
  const one = await hashPassword(ownerPassword), two = await hashPassword(ownerPassword);
  assert.notEqual(one, two);
  const parts = one.split('$');
  assert.equal(parts[5], scryptSync(ownerPassword, Buffer.from(parts[4], 'hex'), 32, { N: 16384, r: 8, p: 5 }).toString('hex'));
});
test('bootstrap requires owner key; no header-only access to inventory', async () => {
  const h = harness();
  assert.deepEqual(await (await h.call('/api/auth/setup-status')).json(), { initialized: false, setupEnabled: true, recoveryEnabled: true });
  assert.equal((await h.call('/api/auth/setup', 'POST', { username: 'rogue', name: 'Rogue', password: ownerPassword })).status, 403);
  assert.equal((await api(h.req('/api/state', 'GET', null, ownerHeaders), h.env)).status, 401);
  const owner = await h.owner();
  assert.match(owner.cookie, /^__Host-ssr_session=[a-f0-9]{64}$/);
  assert.equal((await h.call('/api/auth/setup', 'POST', { username: 'again', name: 'Again', password: ownerPassword }, ownerHeaders)).status, 409);
  const users = await (await h.call('/api/users', 'GET', null, owner)).json();
  assert.equal(users.users.length, 1); assert.equal(JSON.stringify(users).includes('password_hash'), false);
  const response = await h.call('/api/auth/login', 'POST', { username: 'OWNER', password: ownerPassword });
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=43200; Secure/);
  h.DB.close();
});
test('email usernames work for owner setup, staff creation and case-insensitive sign-in', async () => {
  const h = harness();
  try {
    const owner = await credentials(await h.call('/api/auth/setup', 'POST', { username: ' Admin.Name@Example.test ', name: 'Owner', password: ownerPassword }, ownerHeaders));
    const signedIn = await h.signIn(' ADMIN.NAME@EXAMPLE.TEST ', ownerPassword);
    const me = await (await h.call('/api/auth/me', 'GET', null, signedIn)).json();
    assert.equal(me.user.username, 'admin.name@example.test');
    const email = 'construction.site.manager+materials@example.test';
    assert.ok(email.length > 40);
    const staff = await createStaff(h, owner, email.toUpperCase());
    assert.equal(staff.user.username, email);
    let staffSession = await h.signIn(' ' + email.toUpperCase() + ' ', staff.temporaryPassword);
    staffSession = await credentials(await h.call('/api/auth/password', 'POST', { currentPassword: staff.temporaryPassword, password: newPassword }, staffSession));
    assert.equal((await api(h.req('/api/state', 'GET', null, staffSession), h.env)).status, 200);
    await h.signIn(email, newPassword);
    assert.equal((await h.call('/api/users', 'POST', { username: email.toUpperCase(), name: 'Duplicate', role: 'staff' }, owner)).status, 409);
    for (const invalid of ['a@', '@example.test', 'a@@example.test', 'a b@example.test', 'a..b@example.test', '.a@example.test', 'a@-example.test', 'a@example..test', 'a'.repeat(65) + '@example.test', 'a'.repeat(41), 'a@' + ('b'.repeat(63) + '.').repeat(4) + 'test']) {
      assert.equal((await h.call('/api/users', 'POST', { username: invalid, name: 'Invalid', role: 'staff' }, owner)).status, 422, invalid);
    }
  } finally { h.DB.close(); }
});
test('staff lifecycle: create, forced password change, inventory access and admin restrictions', async () => {
  const h = harness(), owner = await h.owner(), staff = await createStaff(h, owner);
  let session = await h.signIn(staff.user.username, staff.temporaryPassword);
  assert.equal((await api(h.req('/api/state', 'GET', null, session), h.env)).status, 403);
  session = await credentials(await h.call('/api/auth/password', 'POST', { currentPassword: staff.temporaryPassword, password: newPassword }, session));
  assert.equal((await api(h.req('/api/state', 'GET', null, session), h.env)).status, 200);
  assert.equal((await h.call('/api/users', 'GET', null, session)).status, 403);
  assert.equal((await h.call('/api/users', 'POST', { username: 'escalation', name: 'Bad', role: 'admin' }, session)).status, 403);
  const record = { name: 'Staff cement', brand: 'Test', category: 'Cement', project: 'Nakshatra', unit: 'Bags', quantity: 10, minimum: 2, price: 400, receivedOn: '2026-01-01T00:00:00Z' };
  assert.equal((await api(h.req('/api/materials', 'POST', record, { ...session, 'idempotency-key': crypto.randomUUID() }), h.env)).status, 201);
  const state = await (await api(h.req('/api/state', 'GET', null, owner), h.env)).json();
  assert.equal(state.materials[0].createdBy, 'Site Staff'); assert.equal(state.movements[0].actorName, 'Site Staff');
  assert.equal(JSON.stringify(state).includes('password_hash'), false); assert.equal(JSON.stringify(state).includes('token_hash'), false);
  const saved = await h.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(staff.user.id).first();
  assert.notEqual(saved.password_hash, newPassword); assert.match(saved.password_hash, /^scrypt\$/);
  h.DB.close();
});
test('resets, deactivation, role changes and logout revoke sessions', async () => {
  const h = harness(), owner = await h.owner(), staff = await createStaff(h, owner);
  let session = await h.signIn(staff.user.username, staff.temporaryPassword);
  session = await credentials(await h.call('/api/auth/password', 'POST', { currentPassword: staff.temporaryPassword, password: newPassword }, session));
  const reset = await (await h.call(`/api/users/${staff.user.id}/reset-password`, 'POST', {}, owner)).json();
  assert.equal((await h.call('/api/auth/me', 'GET', null, session)).status, 401);
  assert.equal((await h.call('/api/auth/login', 'POST', { username: staff.user.username, password: newPassword })).status, 401);
  session = await h.signIn(staff.user.username, reset.temporaryPassword);
  await h.call(`/api/users/${staff.user.id}`, 'PATCH', { active: false, role: 'staff' }, owner);
  assert.equal((await h.call('/api/auth/me', 'GET', null, session)).status, 401);
  assert.equal((await h.call('/api/auth/login', 'POST', { username: staff.user.username, password: reset.temporaryPassword })).status, 401);
  await h.call(`/api/users/${staff.user.id}`, 'PATCH', { active: true, role: 'admin' }, owner);
  session = await h.signIn(staff.user.username, reset.temporaryPassword);
  const changed = await credentials(await h.call('/api/auth/password', 'POST', { currentPassword: reset.temporaryPassword, password: newPassword }, session));
  assert.equal((await h.call('/api/auth/me', 'GET', null, session)).status, 401);
  assert.equal((await h.call('/api/users', 'GET', null, changed)).status, 200);
  await h.call(`/api/users/${staff.user.id}`, 'PATCH', { active: true, role: 'staff' }, owner);
  assert.equal((await h.call('/api/auth/me', 'GET', null, changed)).status, 401);
  session = await h.signIn(staff.user.username, newPassword);
  assert.equal((await h.call('/api/auth/logout', 'POST', {}, session)).status, 200);
  assert.equal((await h.call('/api/auth/me', 'GET', null, session)).status, 401);
  h.DB.close();
});
test('CSRF, weak passwords, duplicate usernames and owner protections are enforced', async () => {
  const h = harness(), owner = await h.owner();
  assert.equal((await h.call('/api/users', 'POST', { username: 'staff', name: 'Staff', role: 'staff' }, { cookie: owner.cookie })).status, 403);
  assert.equal((await h.call('/api/users', 'POST', {}, { ...owner, origin: 'https://attacker.example' })).status, 403);
  assert.equal((await h.call('/api/auth/password', 'POST', { currentPassword: ownerPassword, password: 'short' }, owner)).status, 422);
  assert.equal((await h.call('/api/auth/password', 'POST', { currentPassword: 'wrong', password: newPassword }, owner)).status, 422);
  await createStaff(h, owner);
  assert.equal((await h.call('/api/users', 'POST', { username: 'SITE-STAFF', name: 'Another', role: 'staff' }, owner)).status, 409);
  assert.equal((await h.call('/api/users/owner', 'PATCH', { active: false, role: 'staff' }, owner)).status, 403);
  assert.equal((await h.call('/api/users/owner/reset-password', 'POST', {}, owner)).status, 403);
  h.DB.close();
});
test('expired sessions and temporary passwords are rejected', async () => {
  const h = harness(), owner = await h.owner(), staff = await createStaff(h, owner);
  const session = await h.signIn(staff.user.username, staff.temporaryPassword);
  await h.DB.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').bind(Date.now()-1, staff.user.id).run();
  assert.equal((await h.call('/api/auth/me', 'GET', null, session)).status, 401);
  await h.DB.prepare('UPDATE users SET password_expires=? WHERE id=?').bind(Date.now()-1, staff.user.id).run();
  assert.equal((await h.call('/api/auth/login', 'POST', { username: staff.user.username, password: staff.temporaryPassword })).status, 401);
  h.DB.close();
});
test('owner recovery rejects outsiders and replaces old password and sessions', async () => {
  const h = harness(), owner = await h.owner();
  assert.equal((await h.call('/api/auth/owner-recovery', 'POST', { password: newPassword }, { 'x-owner-key': '3'.repeat(64) })).status, 403);
  await credentials(await h.call('/api/auth/owner-recovery', 'POST', { password: newPassword }, recoveryHeaders));
  assert.equal((await h.call('/api/auth/me', 'GET', null, owner)).status, 401);
  assert.equal((await h.call('/api/auth/login', 'POST', { username: 'owner', password: ownerPassword })).status, 401);
  await h.signIn('owner', newPassword); h.DB.close();
});
test('login rate limits are persisted and bounded by account and IP', async () => {
  const h = harness(), now = Date.now();
  await h.DB.prepare('INSERT INTO auth_limits (key,count,reset_at) VALUES (?,?,?)').bind(await digest('login:target'), 8, now+900000).run();
  assert.equal((await h.call('/api/auth/login', 'POST', { username: 'target', password: ownerPassword })).status, 429);
  await h.DB.prepare('INSERT INTO auth_limits (key,count,reset_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count').bind(await digest('ip:192.0.2.1'),30,now+900000).run();
  assert.equal((await h.call('/api/auth/login', 'POST', { username: 'different', password: ownerPassword })).status, 429);
  h.DB.close();
});
