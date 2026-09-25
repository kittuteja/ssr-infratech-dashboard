import { scryptAsync } from '@noble/hashes/scrypt.js';

const encoder = new TextEncoder();
const COOKIE = '__Host-ssr_session';
const SESSION_SECONDS = 12 * 60 * 60;
const KDF = { N: 16384, r: 8, p: 5, dkLen: 32, maxmem: 32 * 1024 * 1024 };
export class AuthError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new AuthError(status, message, extra); };
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }
});
export function database(env) { if (!env.DB?.prepare) fail(503, 'The database is unavailable. Please try again.'); return env.DB; }
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g) || [], b => parseInt(b, 16));
const random = (size = 32) => hex(crypto.getRandomValues(new Uint8Array(size)));
export const digest = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
function equal(a, b) { let mismatch = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a[i] || 0) ^ (b[i] || 0); return mismatch === 0; }
export async function hashPassword(password, salt = random(16)) {
  const hash = await scryptAsync(encoder.encode(password), unhex(salt), KDF);
  return `scrypt$16384$8$5$${salt}$${hex(hash)}`;
}
async function verifyPassword(password, stored) {
  const parts = (stored || '').split('$');
  const valid = parts.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$16384$8$5' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{64}$/.test(parts[5]);
  const computed = await hashPassword(password, valid ? parts[4] : '0'.repeat(32));
  return equal(encoder.encode(computed), encoder.encode(valid ? stored : 'x'.repeat(computed.length))) && valid;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 15 || value.length > 128) fail(422, 'Use a password of 15–128 characters. A long phrase works well.');
  return value;
}
function username(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const simple = /^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalized);
  const [local, domain, extra] = normalized.split('@');
  const email = normalized.length <= 254 && local.length <= 64 && extra === undefined &&
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local) &&
    typeof domain === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain);
  if (!simple && !email) fail(422, 'Enter a valid email address, or a username of 3–40 letters, numbers, dots, underscores or hyphens.');
  return normalized;
}
function name(value) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) fail(422, 'Enter a name of 1–80 characters.'); return value.trim(); }
function role(value) { if (!['admin', 'staff'].includes(value)) fail(422, 'Choose Admin or Staff.'); return value; }
export function originCheck(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'Open this action from the SSR dashboard.');
}
async function body(request) {
  originCheck(request);
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail(415, 'Use JSON for this request.');
  if (Number(request.headers.get('content-length')) > 10000) fail(413, 'The request is too large.');
  const reader = request.body?.getReader(); let chunks = [], size = 0;
  if (reader) { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 10000) { await reader.cancel(); fail(413, 'The request is too large.'); } chunks.push(part.value); } }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (value && !Array.isArray(value) && typeof value === 'object') return value; } catch {}
  fail(400, 'Invalid request data.');
}
const cookieName = request => new URL(request.url).protocol === 'https:' ? COOKIE : 'ssr_local_session';
const cookieValue = request => (request.headers.get('cookie') || '').split(';').map(c => c.trim()).find(c => c.startsWith(cookieName(request) + '='))?.split('=')[1];
const sessionCookie = (request, token, seconds = SESSION_SECONDS) => `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
const publicUser = user => ({ id: user.id, username: user.username, name: user.name, role: user.role, active: !!user.active, mustChangePassword: !!user.must_change, createdAt: user.created_at, updatedAt: user.updated_at, lastLogin: user.last_login });
export async function session(request, env) {
  const token = cookieValue(request); if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await database(env).prepare('SELECT u.*, s.csrf, s.token_hash, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 AND s.auth_version=u.auth_version').bind(await digest(token), Date.now()).first();
  if (!row || (row.must_change && row.password_expires < Date.now())) return null;
  return row;
}
export async function authorize(request, env, { admin = false, allowChange = false } = {}) {
  const user = await session(request, env); if (!user) fail(401, 'Sign in with your SSR username and password.', { signIn: '/login' });
  if (user.must_change && !allowChange) fail(403, 'Choose your own password before continuing.', { passwordChangeRequired: true });
  if (admin && user.role !== 'admin') fail(403, 'Administrator access is required.');
  if (!['GET', 'HEAD'].includes(request.method)) {
    originCheck(request);
    if (!equal(encoder.encode(request.headers.get('x-csrf-token') || ''), encoder.encode(user.csrf))) fail(403, 'Your session changed. Refresh and try again.');
  }
  return user;
}
async function issueSession(db, request, user) {
  const token = random(), csrf = random(), expires = Date.now() + SESSION_SECONDS * 1000;
  const saved = await db.prepare('INSERT INTO sessions (token_hash,user_id,csrf,auth_version,expires_at) SELECT ?,id,?,auth_version,? FROM users WHERE id=? AND active=1 AND auth_version=?').bind(await digest(token), csrf, expires, user.id, user.auth_version).run();
  if (saved.meta.changes !== 1) fail(401, 'Your account changed. Please sign in again.');
  await db.batch([db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()), db.prepare('DELETE FROM auth_limits WHERE reset_at<=?').bind(Date.now())]);
  return json({ user: publicUser(user), csrf }, 200, { 'set-cookie': sessionCookie(request, token) });
}
async function limit(db, key, maximum, duration = 15 * 60 * 1000) {
  const now = Date.now();
  const result = await db.prepare('INSERT INTO auth_limits (key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING count,reset_at').bind(await digest(key), now + duration, now, now).first();
  if (result.count > maximum) fail(429, 'Too many attempts. Please wait 15 minutes before trying again.');
}
function accountEvent(db, actorId, userId, action) { return db.prepare('INSERT INTO account_audit (id,actor_id,user_id,action,recorded_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actorId, userId, action, new Date().toISOString()); }
export function isOwner(request, env) {
  const key = new URL(request.url).pathname === '/api/auth/owner-recovery' ? env.OWNER_RECOVERY_KEY : env.OWNER_SETUP_KEY;
  const supplied = request.headers.get('x-owner-key') || '';
  return typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) && /^[a-f0-9]{64}$/.test(supplied) && equal(encoder.encode(key), encoder.encode(supplied));
}
async function getUser(db, id) { return db.prepare('SELECT * FROM users WHERE id=?').bind(id).first(); }

export async function authApi(request, env) {
  try {
    const path = new URL(request.url).pathname, db = database(env);
    if (path === '/api/auth/me' && request.method === 'GET') { const user = await authorize(request, env, { allowChange: true }); return json({ user: publicUser(user), csrf: user.csrf }); }
    if (path === '/api/auth/setup-status' && request.method === 'GET') {
      return json({ initialized: !!await getUser(db, 'owner'), setupEnabled: /^[a-f0-9]{64}$/.test(env.OWNER_SETUP_KEY || ''), recoveryEnabled: /^[a-f0-9]{64}$/.test(env.OWNER_RECOVERY_KEY || '') });
    }
    if (['/api/auth/setup', '/api/auth/owner-recovery'].includes(path) && request.method === 'POST') {
      const input = await body(request);
      await limit(db, 'owner-ip:' + (request.headers.get('cf-connecting-ip') || 'unknown'), 10);
      if (!isOwner(request, env)) fail(403, 'The owner key is incorrect or this action is disabled. Contact the deployment owner.');
      await limit(db, 'owner:verified-key', 5);
      const existing = await getUser(db, 'owner');
      if (path.endsWith('/setup') && existing) fail(409, 'The administrator is already set up. Use owner recovery if needed.');
      if (path.endsWith('/owner-recovery') && !existing) fail(409, 'Set up the administrator account first.');
      const hash = await hashPassword(password(input.password)), now = new Date().toISOString();
      if (!existing) {
        const login = username(input.username), displayName = name(input.name);
        try { await db.batch([db.prepare("INSERT INTO users (id,username,name,role,active,password_hash,must_change,auth_version,created_at,updated_at) VALUES ('owner',?,?,'admin',1,?,0,1,?,?)").bind(login, displayName, hash, now, now), accountEvent(db, 'owner', 'owner', 'Owner account created')]); }
        catch (error) { if (/UNIQUE/i.test(error.message)) fail(409, 'The administrator is already set up or that username is taken.'); throw error; }
      } else {
        await db.batch([db.prepare("UPDATE users SET password_hash=?,must_change=0,password_expires=NULL,active=1,auth_version=auth_version+1,updated_at=? WHERE id='owner'").bind(hash, now), db.prepare("DELETE FROM sessions WHERE user_id='owner'"), accountEvent(db, 'owner', 'owner', 'Owner password recovered with deployment recovery key')]);
      }
      return issueSession(db, request, await getUser(db, 'owner'));
    }
    if (path === '/api/auth/login' && request.method === 'POST') {
      const input = await body(request);
      await limit(db, 'ip:' + (request.headers.get('cf-connecting-ip') || 'unknown'), 30);
      const login = username(input.username);
      await limit(db, 'login:' + login, 8);
      const pass = typeof input.password === 'string' && input.password.length <= 128 ? input.password : '';
      const user = await db.prepare('SELECT * FROM users WHERE username=?').bind(login).first();
      const valid = await verifyPassword(pass, user?.password_hash);
      if (!valid || !user?.active) fail(401, 'Incorrect username or password, or this account is inactive.');
      if (user.must_change && user.password_expires < Date.now()) fail(401, 'This temporary password has expired. Ask an administrator to reset it.');
      await db.prepare('UPDATE users SET last_login=? WHERE id=? AND auth_version=?').bind(new Date().toISOString(), user.id, user.auth_version).run();
      await db.prepare('DELETE FROM auth_limits WHERE key=?').bind(await digest('login:' + login)).run();
      return issueSession(db, request, user);
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      const user = await authorize(request, env, { allowChange: true });
      await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run();
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
    }
    if (path === '/api/auth/password' && request.method === 'POST') {
      const user = await authorize(request, env, { allowChange: true }), input = await body(request);
      await limit(db, 'password:' + user.id, 8);
      const nextPassword = password(input.password);
      if (typeof input.currentPassword !== 'string' || input.currentPassword.length > 128 || !await verifyPassword(input.currentPassword, user.password_hash)) fail(422, 'Your current password is incorrect.');
      if (input.currentPassword === nextPassword) fail(422, 'Choose a password different from your current password.');
      const hash = await hashPassword(nextPassword);
      const results = await db.batch([
        db.prepare('UPDATE users SET password_hash=?,must_change=0,password_expires=NULL,auth_version=auth_version+1,updated_at=? WHERE id=? AND auth_version=?').bind(hash, new Date().toISOString(), user.id, user.auth_version),
        db.prepare('DELETE FROM sessions WHERE user_id=? AND auth_version<=?').bind(user.id, user.auth_version),
        accountEvent(db, user.id, user.id, 'Password changed; previous sessions revoked')
      ]);
      if (results[0].meta.changes !== 1) fail(409, 'Your account changed while saving. Sign in again.');
      return issueSession(db, request, await getUser(db, user.id));
    }
    if (path === '/api/users' && request.method === 'GET') {
      await authorize(request, env, { admin: true });
      const rows = await db.prepare('SELECT id,username,name,role,active,must_change,created_at,updated_at,last_login FROM users ORDER BY created_at').all();
      return json({ users: rows.results.map(publicUser) });
    }
    if (path === '/api/users/audit' && request.method === 'GET') {
      await authorize(request, env, { admin: true });
      const rows = await db.prepare('SELECT a.action,a.recorded_at,u.username,u.name,actor.username AS actor FROM account_audit a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN users actor ON actor.id=a.actor_id ORDER BY a.recorded_at DESC LIMIT 100').all();
      return json({ events: rows.results });
    }
    if (path === '/api/users' && request.method === 'POST') {
      const actor = await authorize(request, env, { admin: true }), input = await body(request);
      await limit(db, 'create:' + actor.id, 30);
      const login = username(input.username), displayName = name(input.name), userRole = role(input.role);
      if (await db.prepare('SELECT id FROM users WHERE username=?').bind(login).first()) fail(409, 'That username is already in use.');
      const temporaryPassword = random(16), hash = await hashPassword(temporaryPassword), id = crypto.randomUUID(), now = new Date().toISOString();
      try { await db.batch([db.prepare('INSERT INTO users (id,username,name,role,active,password_hash,must_change,password_expires,auth_version,created_at,updated_at) VALUES (?,?,?,?,1,?,1,?,1,?,?)').bind(id, login, displayName, userRole, hash, Date.now() + 86400000, now, now), accountEvent(db, actor.id, id, 'Account created: ' + userRole)]); }
      catch (error) { if (/UNIQUE/i.test(error.message)) fail(409, 'That username is already in use.'); throw error; }
      return json({ user: publicUser(await getUser(db, id)), temporaryPassword, expiresInHours: 24 }, 201);
    }
    const match = path.match(/^\/api\/users\/([a-f0-9-]+|owner)(\/reset-password)?$/);
    if (match && ['POST', 'PATCH'].includes(request.method)) {
      const actor = await authorize(request, env, { admin: true }), input = await body(request), id = match[1];
      if (id === 'owner' || id === actor.id) fail(403, 'Use your password page for your own account. The owner account cannot be changed here.');
      const target = await getUser(db, id); if (!target) fail(404, 'User not found.');
      if (match[2] && request.method === 'POST') {
        await limit(db, 'reset:' + actor.id, 20);
        const temporaryPassword = random(16), hash = await hashPassword(temporaryPassword);
        await db.batch([db.prepare('UPDATE users SET password_hash=?,must_change=1,password_expires=?,auth_version=auth_version+1,updated_at=? WHERE id=?').bind(hash, Date.now() + 86400000, new Date().toISOString(), id), db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id), accountEvent(db, actor.id, id, 'Temporary password reset; sessions revoked')]);
        return json({ user: publicUser(await getUser(db, id)), temporaryPassword, expiresInHours: 24 });
      }
      if (!match[2] && request.method === 'PATCH') {
        if (typeof input.active !== 'boolean') fail(422, 'An active status is required.');
        const userRole = role(input.role);
        await db.batch([db.prepare('UPDATE users SET active=?,role=?,auth_version=auth_version+1,updated_at=? WHERE id=?').bind(input.active ? 1 : 0, userRole, new Date().toISOString(), id), db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id), accountEvent(db, actor.id, id, `${input.active ? 'Activated' : 'Deactivated'}; role: ${userRole}; sessions revoked`)]);
        return json({ user: publicUser(await getUser(db, id)) });
      }
    }
    return json({ error: 'Endpoint not found.' }, 404);
  } catch (error) {
    if (error instanceof AuthError) return json({ error: error.message, ...error.extra }, error.status, error.status === 429 ? { 'retry-after': '900' } : {});
    console.error('SSR account service error', error?.name);
    return json({ error: 'The account service could not complete this request. Please try again.' }, 503);
  }
}
