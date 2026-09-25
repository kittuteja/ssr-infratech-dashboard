import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { libsqlDatabase } from '../server/libsql.mjs';
import { databaseConfig, validateOwnerKeys } from '../server/vercel-env.mjs';
import { createHandler } from '../server/vercel-handler.mjs';
import { loadMigrations, migrate } from '../scripts/migrations.mjs';
import { digest } from '../server/auth.mjs';

const origin = 'https://ssr-dev.example', setupKey = '4'.repeat(64), recoveryKey = '5'.repeat(64);
const password = 'Isolated owner test phrase 716!';
const material = { name: 'DEV cement', brand: 'Test', category: 'Cement', project: 'Nakshatra', unit: 'Bags', quantity: 10, minimum: 2, price: 400, receivedOn: '2026-01-01T00:00:00Z' };
function call(handler, path, method = 'GET', body, headers = {}) {
  return handler.fetch(new Request(origin + path, { method, headers: { origin, 'content-type': 'application/json', 'x-vercel-forwarded-for': '192.0.2.20', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }));
}
async function credentials(response) {
  const body = await response.json(); assert.equal(response.status, 200, body.error);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=43200; Secure/);
  return { cookie: response.headers.get('set-cookie').split(';')[0], 'x-csrf-token': body.csrf };
}

test('Vercel rejects missing/ephemeral databases and weak or reused owner keys', () => {
  assert.throws(() => databaseConfig({ VERCEL: '1' }), /TURSO_DATABASE_URL/);
  for (const url of ['file:/tmp/test.db', ':memory:', 'http://example.test']) assert.throws(() => databaseConfig({ VERCEL: '1', TURSO_DATABASE_URL: url }), /remote/);
  assert.throws(() => databaseConfig({ VERCEL: '1', TURSO_DATABASE_URL: 'libsql://example.test' }), /TURSO_AUTH_TOKEN/);
  assert.throws(() => validateOwnerKeys({ OWNER_SETUP_KEY: 'short' }), /hexadecimal/);
  assert.throws(() => validateOwnerKeys({ OWNER_SETUP_KEY: setupKey, OWNER_RECOVERY_KEY: setupKey }), /different/);
  assert.doesNotThrow(() => validateOwnerKeys({}));
});

test('libSQL migrations are repeatable, detect edits and roll back failed schema changes', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    const migrations = await loadMigrations();
    assert.equal(await migrate(client, migrations), 2);
    assert.equal(await migrate(client, migrations), 0);
    await assert.rejects(migrate(client, [{ ...migrations[0], hash: 'changed' }]), /Previously applied/);
    await assert.rejects(migrate(client, [{ name: 'broken.sql', hash: 'x', statements: ['CREATE TABLE rollback_test (id TEXT)', 'THIS IS INVALID SQL'] }]));
    assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name='rollback_test'")).rows.length, 0);
    assert.equal((await client.execute("SELECT name FROM ssr_migrations WHERE name='broken.sql'")).rows.length, 0);
  } finally { client.close(); }
});

test('Vercel handler and libSQL support owner/staff lifecycle, durable stock, concurrency and isolation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ssr-vercel-test-'));
  let client;
  try {
    const config = { url: 'file:' + join(dir, 'dev.db') };
    client = createClient(config);
    await migrate(client, await loadMigrations());
    let DB = libsqlDatabase(client);
    const env = { VERCEL: '1', OWNER_SETUP_KEY: setupKey, OWNER_RECOVERY_KEY: recoveryKey };
    let handler = createHandler({ env, openDatabase: () => DB });
    const forged = { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test', 'cf-connecting-ip': 'spoofed' };
    const setup = { username: 'Admin.Name@example.test', name: 'DEV Owner', password };
    assert.equal((await call(handler, '/api/auth/setup', 'POST', setup, forged)).status, 403);
    assert.equal((await call(handler, '/api/state', 'GET', null, forged)).status, 401);
    assert.equal((await call(handler, '/api/auth/setup', 'POST', setup, { 'x-owner-key': recoveryKey })).status, 403);
    let owner = await credentials(await call(handler, '/api/auth/setup', 'POST', setup, { 'x-owner-key': setupKey }));
    assert.equal((await call(handler, '/api/auth/setup', 'POST', setup, { 'x-owner-key': setupKey })).status, 409);
    assert.equal((await call(handler, '/api/auth/owner-recovery', 'POST', { password }, { 'x-owner-key': setupKey })).status, 403);
    const rate = await DB.prepare('SELECT count FROM auth_limits WHERE key=?').bind(await digest('owner-ip:192.0.2.20')).first();
    assert.equal(rate.count, 5);
    assert.equal(await DB.prepare('SELECT count FROM auth_limits WHERE key=?').bind(await digest('owner-ip:spoofed')).first(), null);
    delete env.OWNER_SETUP_KEY;
    assert.equal((await (await call(handler, '/api/auth/setup-status')).json()).setupEnabled, false);

    const staffResponse = await call(handler, '/api/users', 'POST', { username: 'Site.Staff+dev@example.test', name: 'DEV Staff', role: 'staff' }, owner);
    assert.equal(staffResponse.status, 201);
    const staff = await staffResponse.json();
    let staffSession = await credentials(await call(handler, '/api/auth/login', 'POST', { username: staff.user.username.toUpperCase(), password: staff.temporaryPassword }));
    assert.equal((await call(handler, '/api/state', 'GET', null, staffSession)).status, 403);
    const newPassword = 'Staff personal testing phrase 839!';
    staffSession = await credentials(await call(handler, '/api/auth/password', 'POST', { currentPassword: staff.temporaryPassword, password: newPassword }, staffSession));
    assert.equal((await call(handler, '/api/users', 'GET', null, staffSession)).status, 403);
    assert.equal((await call(handler, '/api/materials', 'POST', material, { ...staffSession, origin: 'https://evil.test' })).status, 403);
    const key = crypto.randomUUID(), headers = { ...staffSession, 'idempotency-key': key };
    const created = await call(handler, '/api/materials', 'POST', material, headers);
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await (await call(handler, '/api/materials', 'POST', material, headers)).json()).id, id);
    const issue = { version: 1, type: 'issued', quantity: 7, note: 'DEV work', occurredAt: '2026-01-02T00:00:00Z', batch: 'DEV-1' };
    const results = await Promise.all([1, 2].map(() => call(handler, `/api/materials/${id}/movements`, 'POST', issue, { ...staffSession, 'idempotency-key': crypto.randomUUID() })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    await assert.rejects(DB.batch([DB.prepare('UPDATE materials SET quantity100=900 WHERE id=?').bind(id), DB.prepare('INSERT INTO users (id) VALUES (?)').bind('invalid')]));

    // Simulate a new server instance against the same persisted database.
    client.close(); client = createClient(config); DB = libsqlDatabase(client);
    handler = createHandler({ env, openDatabase: () => DB });
    const state = await (await call(handler, '/api/state', 'GET', null, staffSession)).json();
    assert.equal(state.materials.length, 1); assert.equal(state.materials[0].quantity, 3);
    assert.equal(state.materials[0].createdBy, 'DEV Staff'); assert.equal(state.movements.length, 2);
    assert.equal(state.movements.find(m => m.type === 'issued').batch, 'DEV-1');
    assert.equal(JSON.stringify(state).includes('password_hash'), false);
    await credentials(await call(handler, '/api/auth/login', 'POST', { username: staff.user.username, password: newPassword }));
    const reset = await call(handler, `/api/users/${staff.user.id}/reset-password`, 'POST', {}, owner);
    assert.equal(reset.status, 200);
    assert.equal((await call(handler, '/api/state', 'GET', null, staffSession)).status, 401);
    owner = await credentials(await call(handler, '/api/auth/owner-recovery', 'POST', { password: 'Recovered owner testing phrase 625!' }, { 'x-owner-key': recoveryKey }));
    delete env.OWNER_RECOVERY_KEY;
    assert.equal((await call(handler, '/api/auth/owner-recovery', 'POST', { password }, { 'x-owner-key': recoveryKey })).status, 403);
    assert.equal((await call(handler, '/api/state', 'GET', null, owner)).status, 200);
    assert.equal((await call(handler, '/login')).status, 200);
    assert.match(await (await call(handler, '/owner-setup')).text(), /Owner setup key/);
    assert.equal((await call(handler, '/index.html')).status, 302);
    assert.equal((await call(handler, '/users', 'GET', null, staffSession)).status, 302);

    const isolated = createClient({ url: 'file:' + join(dir, 'preview.db') });
    try {
      await migrate(isolated, await loadMigrations());
      assert.equal((await isolated.execute('SELECT * FROM materials')).rows.length, 0);
      assert.equal((await isolated.execute('SELECT * FROM users')).rows.length, 0);
    } finally { isolated.close(); }
  } finally { client?.close(); await rm(dir, { recursive: true, force: true }); }
});
