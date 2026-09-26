import { createClient } from '@libsql/client';
import { databaseConfig, validateOwnerKeys, DatabaseConfigurationError } from '../server/vercel-env.mjs';
import { loadMigrations, migrate } from './migrations.mjs';
import { databaseFailureMessage, deploymentLabel } from './database-diagnostics.mjs';

let client, stage = 'configuration';
console.log(`Database initialization target: ${deploymentLabel(process.env)}.`);
try {
  validateOwnerKeys(process.env);
  client = createClient(databaseConfig(process.env));
  stage = 'connection';
  // Catch missing first-owner configuration during deployment, before publishing.
  const hasUsers = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")).rows.length;
  stage = 'owner check';
  const hasOwner = hasUsers && (await client.execute("SELECT id FROM users WHERE id='owner'")).rows.length;
  if (!hasOwner && !process.env.OWNER_SETUP_KEY) throw new DatabaseConfigurationError('OWNER_SETUP_REQUIRED', 'An empty database requires OWNER_SETUP_KEY.');
  stage = 'migrations';
  console.log(`Database ready: ${await migrate(client, await loadMigrations())} new migration(s) applied.`);
} catch (error) {
  // Provider errors can contain connection details. Do not print credentials.
  console.error(databaseFailureMessage(error, { stage, env: process.env }));
  process.exitCode = 1;
} finally { client?.close(); }
