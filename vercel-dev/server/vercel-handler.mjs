import app from '../dist/server/index.js';
import { validateOwnerKeys } from './vercel-env.mjs';

export function createHandler({ env, openDatabase }) {
  let DB;
  return { async fetch(request) {
    try {
      validateOwnerKeys(env);
      DB ||= openDatabase();
      const headers = new Headers(request.headers);
      // Only Vercel's overwritten forwarding header supplies the rate-limit IP.
      // Former host identity headers must never establish owner privileges.
      for (const name of [...headers.keys()]) if (name.startsWith('oai-')) headers.delete(name);
      headers.set('cf-connecting-ip', env.VERCEL ? (headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() || 'unknown') : 'local-preview');
      return await app.fetch(new Request(request, { headers }), {
        DB, OWNER_SETUP_KEY: env.OWNER_SETUP_KEY, OWNER_RECOVERY_KEY: env.OWNER_RECOVERY_KEY
      });
    } catch (error) {
      console.error('SSR hosting configuration error', error?.name);
      return Response.json({ error: 'The dashboard is not configured yet. Contact the deployment owner.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  } };
}
