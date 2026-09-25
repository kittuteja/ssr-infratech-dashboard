import { createClient } from '@libsql/client';
import { databaseConfig, validateOwnerKeys } from '../server/vercel-env.mjs';
import { loadMigrations, migrate } from './migrations.mjs';

let client;
try {
  validateOwnerKeys(process.env);
  client = createClient(databaseConfig(process.env));
  // Catch missing first-owner configuration during deployment, before publishing.
  const hasUsers = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")).rows.length;
  const hasOwner = hasUsers && (await client.execute("SELECT id FROM users WHERE id='owner'")).rows.length;
  if (!hasOwner && !process.env.OWNER_SETUP_KEY) throw new Error('An empty database requires OWNER_SETUP_KEY.');
  console.log(`Database ready: ${await migrate(client, await loadMigrations())} new migration(s) applied.`);
} catch (error) {
  // Provider errors can contain connection details. Do not print credentials.
  console.error('Database initialization failed. Check the database URL, token, connectivity, owner key format, and unchanged migration files.');
  process.exitCode = 1;
} finally { client?.close(); }
