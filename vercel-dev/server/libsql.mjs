// Preserve the prepared-statement API used by inventory and authentication.
// A write batch runs on one connection, in order, so SQLite changes() guards
// and stock/history/idempotency writes remain one atomic transaction.
export function libsqlDatabase(client) {
  let writeQueue = Promise.resolve();
  const result = value => ({
    results: value.rows.map(row => ({ ...row })),
    meta: { changes: value.rowsAffected, last_row_id: Number(value.lastInsertRowid || 0) },
    success: true
  });
  function prepare(sql, args = []) {
    return {
      sql, args,
      bind(...values) { return prepare(sql, values); },
      async first() { return (await client.execute({ sql, args })).rows[0] || null; },
      async all() { return result(await client.execute({ sql, args })); },
      async run() { return result(await client.execute({ sql, args })); }
    };
  }
  return {
    prepare,
    async batch(statements) {
      return (await client.batch(statements.map(({ sql, args }) => ({ sql, args })), 'write')).map(result);
    },
    async transaction(action) {
      // Serialize interactive writes within an instance. BEGIN IMMEDIATE also
      // protects against writers on other serverless instances at the primary.
      const previous = writeQueue;
      let release;
      writeQueue = new Promise(resolve => { release = resolve; });
      await previous;
      let tx;
      try {
        tx = await client.transaction('write');
        const value = await action(libsqlDatabase(tx));
        await tx.commit();
        return value;
      } catch (error) {
        if (tx) await tx.rollback();
        throw error;
      } finally { tx?.close(); release(); }
    },
    close() { client.close(); }
  };
}
