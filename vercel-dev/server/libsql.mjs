// Preserve the prepared-statement API used by inventory and authentication.
// A write batch runs on one connection, in order, so SQLite changes() guards
// and stock/history/idempotency writes remain one atomic transaction.
export function libsqlDatabase(client) {
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
    close() { client.close(); }
  };
}
