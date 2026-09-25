import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function loadMigrations(directory = new URL('../drizzle/', import.meta.url)) {
  return Promise.all((await readdir(directory)).filter(name => name.endsWith('.sql')).sort().map(async name => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    return { name, hash: createHash('sha256').update(sql).digest('hex'), statements: sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean) };
  }));
}

export async function migrate(client, migrations) {
  // Serialize concurrent deploys and commit schema plus ledger together.
  const tx = await client.transaction('write');
  try {
    await tx.execute('CREATE TABLE IF NOT EXISTS ssr_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
    let applied = 0;
    for (const migration of migrations) {
      const saved = (await tx.execute({ sql: 'SELECT hash FROM ssr_migrations WHERE name=?', args: [migration.name] })).rows[0];
      if (saved) {
        if (saved.hash !== migration.hash) throw new Error(`Previously applied migration changed: ${migration.name}`);
        continue;
      }
      for (const sql of migration.statements) await tx.execute(sql);
      await tx.execute({ sql: 'INSERT INTO ssr_migrations (name,hash) VALUES (?,?)', args: [migration.name, migration.hash] });
      applied++;
    }
    await tx.commit();
    return applied;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally { tx.close(); }
}
