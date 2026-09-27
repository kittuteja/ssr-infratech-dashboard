import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createClient} from '@libsql/client';
import {databaseConfig,validateOwnerKeys} from '../server/vercel-env.mjs';
import {databaseFailureMessage} from '../scripts/database-diagnostics.mjs';
import {migrate} from '../scripts/migrations.mjs';

const preview={VERCEL:'1',VERCEL_ENV:'preview'};
function failure(action) {try{action();assert.fail('Expected a configuration error');}catch(error){return error;}}
test('missing Preview database variables identify the setting and scope without using Production values',()=>{
  const url=databaseFailureMessage(failure(()=>databaseConfig(preview)),{env:preview});
  assert.match(url,/DB_URL_MISSING/);assert.match(url,/TURSO_DATABASE_URL is missing/);assert.match(url,/Vercel Preview/);assert.match(url,/Production-only values are not available/);
  const token=databaseFailureMessage(failure(()=>databaseConfig({...preview,TURSO_DATABASE_URL:'libsql://private-host.example'})),{env:preview});
  assert.match(token,/DB_TOKEN_MISSING/);assert.match(token,/TURSO_AUTH_TOKEN is missing/);assert.equal(token.includes('private-host'),false);
});

test('owner-key errors are actionable and never echo configured secrets',()=>{
  const secret='private-owner-value';
  for(const name of ['OWNER_SETUP_KEY','OWNER_RECOVERY_KEY']){
    const msg=databaseFailureMessage(failure(()=>validateOwnerKeys({[name]:secret})),{env:preview});
    assert.match(msg,new RegExp(name+'_INVALID'));assert.equal(msg.includes(secret),false);
  }
  const msg=databaseFailureMessage(failure(()=>validateOwnerKeys({OWNER_SETUP_KEY:'a'.repeat(64),OWNER_RECOVERY_KEY:'a'.repeat(64)})));
  assert.match(msg,/OWNER_KEYS_REUSED/);assert.equal(msg.includes('a'.repeat(64)),false);
});

test('nested provider failures are classified from allowlisted codes/statuses, never raw response details',()=>{
  const secret='token-private-123';
  const nested=new Error('https://private-host.example?token='+secret,{cause:Object.assign(new Error(secret),{status:401})});
  let msg=databaseFailureMessage(nested,{stage:'connection',env:preview});assert.match(msg,/DB_HTTP_401/);assert.match(msg,/rejected authentication/);
  assert.equal(msg.includes(secret),false);assert.equal(msg.includes('private-host'),false);
  for(const code of ['SQLITE_READONLY','SQLITE_BUSY','ENOTFOUND','TRANSACTION_TIMEOUT','URL_INVALID']){
    msg=databaseFailureMessage(Object.assign(new Error(secret),{code}));assert.match(msg,new RegExp(code));assert.equal(msg.includes(secret),false);
  }
  const unknown=Object.assign(new Error(secret),{code:secret,status:secret,migration:'https://private-host/'+secret,statement:secret});unknown.cause=unknown;
  msg=databaseFailureMessage(unknown,{stage:secret,env:{VERCEL:'1',VERCEL_ENV:secret}});
  assert.match(msg,/DB_INITIALIZATION_FAILED/);assert.equal(msg.includes(secret),false);assert.equal(msg.includes('private-host'),false);
});

test('migration failures report the exact file/statement and retain rollback and checksum protection',async()=>{
  const client=createClient({url:':memory:'});
  try {
    const bad={name:'0003_test.sql',hash:'bad',statements:['CREATE TABLE should_rollback(id TEXT)','INVALID SQL containing_private_data']};
    let error;try{await migrate(client,[bad]);}catch(e){error=e;}
    assert.ok(error);const msg=databaseFailureMessage(error,{stage:'migrations',env:preview});assert.match(msg,/0003_test.sql, statement 2/);assert.match(msg,/SQLITE_ERROR/);assert.equal(msg.includes('containing_private_data'),false);
    assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name='should_rollback'")).rows.length,0);
    const good={name:'0003_test.sql',hash:'good',statements:['CREATE TABLE retained(id TEXT)']};await migrate(client,[good]);
    try{await migrate(client,[{...good,hash:'edited'}]);assert.fail('Expected checksum failure');}catch(e){assert.match(databaseFailureMessage(e),/MIGRATION_CHANGED/);assert.match(databaseFailureMessage(e),/Restore its original file from Git/);}
  }finally{client.close();}
});

test('migration CLI exits with a useful Preview error before connecting when variables are absent',()=>{
  const env={...process.env,...preview,TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',OWNER_SETUP_KEY:'',OWNER_RECOVERY_KEY:''};
  const result=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stdout,/Database initialization target: Vercel Preview/);assert.match(result.stderr,/DB_URL_MISSING/);assert.match(result.stderr,/TURSO_DATABASE_URL is missing/);
});

test('migration CLI distinguishes an empty database needing owner setup from a connection error',()=>{
  const env={...process.env,VERCEL:'',VERCEL_ENV:'',TURSO_DATABASE_URL:':memory:',TURSO_AUTH_TOKEN:'',OWNER_SETUP_KEY:'',OWNER_RECOVERY_KEY:''};
  const result=spawnSync(process.execPath,['scripts/migrate.mjs'],{env,encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/OWNER_SETUP_REQUIRED/);assert.match(result.stderr,/owner check/);assert.match(result.stderr,/no owner account/);
});
