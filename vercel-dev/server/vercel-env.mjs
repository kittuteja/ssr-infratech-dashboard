export function databaseConfig(env) {
  const url = env.TURSO_DATABASE_URL;
  if (!url) throw new Error('Set TURSO_DATABASE_URL to your Turso libSQL database URL.');
  if (env.VERCEL && !/^(libsql|https):\/\//.test(url)) throw new Error('Vercel requires a remote libSQL database; local files are not persistent.');
  if (/^(libsql|https):\/\//.test(url) && !env.TURSO_AUTH_TOKEN) throw new Error('Set TURSO_AUTH_TOKEN for the remote database.');
  return { url, authToken: env.TURSO_AUTH_TOKEN || undefined };
}

export function validateOwnerKeys(env) {
  for (const name of ['OWNER_SETUP_KEY', 'OWNER_RECOVERY_KEY']) {
    if (env[name] && !/^[a-f0-9]{64}$/.test(env[name])) throw new Error(`${name} must be a random 64-character hexadecimal key. Run npm run setup:key.`);
  }
  if (env.OWNER_SETUP_KEY && env.OWNER_SETUP_KEY === env.OWNER_RECOVERY_KEY) throw new Error('Use different keys for setup and recovery.');
}
