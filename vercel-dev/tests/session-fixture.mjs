import { localDatabase as sqliteDatabase } from '../scripts/sqlite-d1.mjs';
import { digest } from '../server/auth.mjs';
const token = 'a'.repeat(64);
export const fixtureHeaders = { cookie: '__Host-ssr_session=' + token, 'x-csrf-token': 'test-csrf' };
export async function fixtureDatabase() {
  const DB = sqliteDatabase(), now = new Date().toISOString();
  await DB.prepare('INSERT INTO users (id,username,name,role,active,password_hash,must_change,auth_version,created_at,updated_at) VALUES (?,?,?,?,1,?,0,1,?,?)').bind('test-user','inventory-test','owner@example.test','staff','not-a-real-login-hash',now,now).run();
  await DB.prepare('INSERT INTO sessions (token_hash,user_id,csrf,auth_version,expires_at) VALUES (?,?,?,1,?)').bind(await digest(token),'test-user','test-csrf',Date.now()+3600000).run();
  return DB;
}
