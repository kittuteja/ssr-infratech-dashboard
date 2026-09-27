// Build logs are often shared. Never emit raw provider messages, URLs, tokens,
// SQL text, owner keys, stacks, or arbitrary error codes here.
const configMessages = {
  DB_URL_MISSING: 'TURSO_DATABASE_URL is missing. Set the remote libSQL URL for this deployment environment.',
  DB_REMOTE_REQUIRED: 'TURSO_DATABASE_URL must be a remote libsql:// or https:// URL on Vercel; local files are not persistent.',
  DB_TOKEN_MISSING: 'TURSO_AUTH_TOKEN is missing. Set a database-scoped read/write token for the selected database.',
  OWNER_SETUP_KEY_INVALID: 'OWNER_SETUP_KEY must be 64 lowercase hexadecimal characters. Generate it with npm run setup:key, or remove it if owner setup is not needed.',
  OWNER_RECOVERY_KEY_INVALID: 'OWNER_RECOVERY_KEY must be 64 lowercase hexadecimal characters. Leave it unset unless performing owner recovery.',
  OWNER_KEYS_REUSED: 'OWNER_SETUP_KEY and OWNER_RECOVERY_KEY must be different. Leave recovery unset for ordinary deployments.',
  OWNER_SETUP_REQUIRED: 'The selected database has no owner account. Set OWNER_SETUP_KEY for this environment using npm run setup:key. Existing database owners do not need a new key.'
};
const providerMessages = {
  URL_INVALID: 'The database URL is invalid. Copy the libSQL connection URL from the intended DEV/preview database.',
  URL_SCHEME_NOT_SUPPORTED: 'The database URL scheme is unsupported. Vercel requires libsql:// or https://.',
  URL_PARAM_NOT_SUPPORTED: 'The database URL has unsupported parameters. Use the database connection URL without embedding its token.',
  AUTH_FAILED: 'Database authentication failed. Check that the token is valid and belongs to the selected DEV/preview database.',
  AUTH_EXPIRED: 'The database token has expired. Replace it in this deployment environment and redeploy.',
  UNAUTHORIZED: 'Database access was denied. Check the database URL and its database-scoped read/write token.',
  SQLITE_AUTH: 'The database denied access. Check the token and database permissions.',
  SQLITE_READONLY: 'The database or token is read-only. Schema migrations require write access.',
  SQLITE_BUSY: 'The database is busy with another writer. Wait for other builds/writes to finish, then redeploy.',
  SQLITE_LOCKED: 'The database is locked by another operation. Retry after that operation finishes.',
  TRANSACTION_TIMEOUT: 'The migration transaction timed out. Check database connectivity and retry.',
  TRANSACTION_CLOSED: 'The migration transaction closed before completion. Check connectivity and retry.',
  SQLITE_CONSTRAINT: 'A database constraint rejected a migration. Inspect the indicated migration and existing DEV schema; do not delete data or change applied migration files.',
  SQLITE_CONSTRAINT_FOREIGNKEY: 'A foreign-key constraint rejected a migration. Inspect the indicated migration and existing DEV schema.',
  SQLITE_ERROR: 'The database rejected SQL. Inspect the indicated migration/statement and confirm the database uses the libSQL engine.',
  HRANA_PROTO_ERROR: 'The server returned an unexpected libSQL response. Check the database URL and libSQL engine.',
  HRANA_CLOSED_ERROR: 'The database connection closed unexpectedly. Check database availability and retry.',
  HRANA_WEBSOCKET_ERROR: 'The database connection failed. Check connectivity and database availability.',
  PROTOCOL_VERSION_ERROR: 'The database protocol is incompatible. Confirm the database uses the supported libSQL engine.',
  ENOTFOUND: 'The database hostname could not be resolved. Check the URL in this deployment environment.',
  ECONNREFUSED: 'The database connection was refused. Check the endpoint and service availability.',
  ECONNRESET: 'The database connection was interrupted. Check service availability and retry.',
  ETIMEDOUT: 'The database connection timed out. Check service availability and retry.',
  UND_ERR_CONNECT_TIMEOUT: 'The database connection timed out. Check service availability and retry.'
};
export function deploymentLabel(env) {
  if (!env.VERCEL) return 'local';
  return {preview:'Vercel Preview',production:'Vercel Production',development:'Vercel Development'}[env.VERCEL_ENV] || 'Vercel custom/unspecified';
}
export function databaseFailureMessage(error,{stage='configuration',env={}}={}) {
  const chain=[];for(let e=error;e&&chain.length<8&&!chain.includes(e);e=e.cause)chain.push(e);
  let code='DB_INITIALIZATION_FAILED',message='Database initialization failed. Verify the URL, read/write token, database availability and libSQL engine for this deployment environment.';
  const configured=chain.find(e=>Object.hasOwn(configMessages,e.code));
  if(configured){code=configured.code;message=configMessages[code];}
  else if(chain.some(e=>e.code==='MIGRATION_CHANGED')){code='MIGRATION_CHANGED';message='A previously applied migration has a different checksum. Restore its original file from Git; create a new migration for later changes. Do not reset the database or edit the migration ledger.';}
  else {
    const http=chain.find(e=>[401,403,404,429,500,502,503,504].includes(e.status));
    const provider=chain.find(e=>Object.hasOwn(providerMessages,e.code));
    if(http){
      code='DB_HTTP_'+http.status;
      message=http.status===401?'The database rejected authentication (HTTP 401). Check for an expired/incorrect token or a token belonging to another database.':
        http.status===403?'Database access is forbidden (HTTP 403). Verify token permissions and database access rules.':
        http.status===404?'The database endpoint was not found (HTTP 404). Check the selected DEV/preview database URL.':
        http.status===429?'The database service is rate limiting requests (HTTP 429). Retry after the limit clears.':
        'The database service returned an availability error. Retry after checking Turso service status.';
    }else if(provider){code=provider.code;message=providerMessages[code];}
  }
  const migration=chain.find(e=>typeof e.migration==='string'&&/^[a-zA-Z0-9_-]+\.sql$/.test(e.migration));
  const location=migration?` Migration: ${migration.migration}${Number.isInteger(migration.statement)&&migration.statement>0?', statement '+migration.statement:''}.`:'';
  const safeStage=['configuration','connection','owner check','migrations'].includes(stage)?stage:'initialization';
  const scope=env.VERCEL_ENV==='preview'?' Set variables in Settings → Environment Variables → Preview (including any branch override). Production-only values are not available to pull-request builds. Use a separate preview database.':env.VERCEL?' Check the environment shown for this deployment; the Development scope is for local vercel dev.':'';
  return `[${code}] ${deploymentLabel(env)} · ${safeStage}: ${message}${location}${scope}`;
}
