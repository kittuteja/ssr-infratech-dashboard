import { createClient } from '@libsql/client/web';
import { libsqlDatabase } from '../server/libsql.mjs';
import { databaseConfig } from '../server/vercel-env.mjs';
import { createHandler } from '../server/vercel-handler.mjs';

export default createHandler({ env: process.env, openDatabase: () => libsqlDatabase(createClient(databaseConfig(process.env))) });
