import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { libsqlDatabase } from '../server/libsql.mjs';
import { validateOwnerKeys } from '../server/vercel-env.mjs';
import { migrate, loadMigrations } from './migrations.mjs';
import app from '../dist/server/index.js';

// Local testing always uses its own file database, even if cloud credentials exist.
mkdirSync('.sites-runtime', { recursive: true });
validateOwnerKeys(process.env);
const client = createClient({ url: 'file:.sites-runtime/vercel-development.sqlite' });
await migrate(client, await loadMigrations());
const DB = libsqlDatabase(client), port = Number(process.env.PORT || 4176);
const server = createServer(async (req, res) => {
  try {
    if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host)) { res.writeHead(403); res.end('Local preview only'); return; }
    const url = new URL(req.url, 'http://' + req.headers.host), headers = new Headers(req.headers);
    for (const name of [...headers.keys()]) if (name.startsWith('oai-')) headers.delete(name);
    headers.set('cf-connecting-ip', req.socket.remoteAddress || 'local-preview');
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 20000) { res.writeHead(413); res.end('Request too large'); return; } chunks.push(chunk); }
      body = Buffer.concat(chunks);
    }
    const response = await app.fetch(new Request(url, { method: req.method, headers, body }), { DB, OWNER_SETUP_KEY: process.env.OWNER_SETUP_KEY, OWNER_RECOVERY_KEY: process.env.OWNER_RECOVERY_KEY });
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error('Preview server error', error?.name); res.writeHead(500); res.end('Preview server error'); }
}).listen(port, '127.0.0.1', () => console.log(`SSR Vercel DEV preview: http://127.0.0.1:${port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => { client.close(); process.exit(0); }); });
