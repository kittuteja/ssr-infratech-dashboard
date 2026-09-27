import { api } from './api.mjs';
import { financeApi } from './finance-api.mjs';
import { authApi, session, json } from './auth.mjs';
import { assets } from './assets.mjs';
const publicAssets = new Set(['/login', '/login.html', '/owner-setup', '/account.js', '/account.css', '/styles.css', '/ssr-logo.jpg', '/favicon.jpg']);
const pages = { '/': '/index.html', '/login': '/login.html', '/owner-setup': '/setup.html', '/password': '/password.html', '/users': '/users.html', '/people-payments': '/finance.html' };
const redirect = location => new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
export default { async fetch(request, env) {
  try {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/auth/') || path === '/api/users' || path.startsWith('/api/users/')) return authApi(request, env);
    if (path === '/api/finance' || path.startsWith('/api/finance/')) return financeApi(request, env);
    if (path.startsWith('/api/')) return api(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    if (!publicAssets.has(path)) {
      const user = await session(request, env);
      if (!user) return redirect('/login');
      if (user.must_change && !['/password', '/password.html'].includes(path)) return redirect('/password');
      if (['/users', '/users.html', '/people-payments', '/finance.html', '/finance.js', '/finance.css'].includes(path) && user.role !== 'admin') return new Response('Administrator access required', { status: 403 });
    }
    const asset = assets[pages[path] || path];
    if (!asset) return new Response('Not found', { status: 404 });
    const bytes = Uint8Array.from(atob(asset.data), c => c.charCodeAt(0));
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
      'content-type': asset.type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin', 'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    } });
  } catch (error) { console.error('SSR request error', error?.name); return json({ error: 'The service is temporarily unavailable. Please try again.' }, 503); }
} };
