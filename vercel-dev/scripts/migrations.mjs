import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function loadMigrations(directory = new URL('../drizzle/', import.meta.url)) {
  return Promise.all((await readdir(directory)).filter(name => name.endsWith('.sql')).sort().map(async name => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    return { name, hash: createHash('sha256').update(sql).digest('hex'), statements: sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean) };
  }));
}

export class MigrationError extends Error {
  constructor(message, code, migration, statement, cause) {
    super(message, { cause }); this.name = 'MigrationError';
    Object.assign(this, { code, migration, statement });
  }
}

export async function migrate(client, migrations) {
  // Serialize concurrent deploys and commit schema plus ledger together.
  const tx = await client.transaction('write');
  let migrationName, statement;
  try {
    await tx.execute('CREATE TABLE IF NOT EXISTS ssr_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
    let applied = 0;
    for (const migration of migrations) {
      migrationName = migration.name; statement = undefined;
      const saved = (await tx.execute({ sql: 'SELECT hash FROM ssr_migrations WHERE name=?', args: [migration.name] })).rows[0];
      if (saved) {
        if (saved.hash !== migration.hash) throw new MigrationError(`Previously applied migration changed: ${migration.name}`, 'MIGRATION_CHANGED', migration.name);
        continue;
      }
      for (let i = 0; i < migration.statements.length; i++) {
        statement = i + 1;
        await tx.execute(migration.statements[i]);
      }
      statement = undefined;
      await tx.execute({ sql: 'INSERT INTO ssr_migrations (name,hash) VALUES (?,?)', args: [migration.name, migration.hash] });
      applied++;
    }
    await tx.commit();
    return applied;
  } catch (error) {
    try { await tx.rollback(); } catch { /* Preserve the original failure if the connection already closed. */ }
    if (error instanceof MigrationError) throw error;
    throw new MigrationError('Database migration failed.', 'MIGRATION_FAILED', migrationName, statement, error);
  } finally { tx.close(); }
}
