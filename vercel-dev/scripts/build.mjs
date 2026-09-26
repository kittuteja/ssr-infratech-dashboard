import { mkdir, readFile, writeFile, copyFile, rm, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
// Vercel requires a non-empty static output directory. Only the already-public
// favicon is copied here; dashboard pages and APIs stay behind the function.
await mkdir('dist/static', { recursive: true });
await copyFile('public/favicon.jpg', 'dist/static/favicon.jpg');
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', jpg: 'image/jpeg' };
const assets = {};
for (const file of await readdir('public')) {
  const type = types[file.split('.').pop()];
  if (type) assets['/' + file] = { type, data: (await readFile('public/' + file)).toString('base64') };
}
await writeFile('dist/server/assets.mjs', 'export const assets=' + JSON.stringify(assets) + ';\n');
await build({ entryPoints: ['server/worker.mjs'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', plugins: [{ name: 'assets', setup(builder) { builder.onResolve({ filter: /\/assets\.mjs$/ }, () => ({ path: decodeURIComponent(new URL('../dist/server/assets.mjs', import.meta.url).pathname) })); } }] });
console.log('Built SSR account and inventory app for Vercel.');
