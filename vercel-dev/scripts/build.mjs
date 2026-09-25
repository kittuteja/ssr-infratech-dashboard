import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
// All assets go through the authenticated function, never a public static copy.
await mkdir('dist/static', { recursive: true });
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', jpg: 'image/jpeg' };
const assets = {};
for (const file of await readdir('public')) {
  const type = types[file.split('.').pop()];
  if (type) assets['/' + file] = { type, data: (await readFile('public/' + file)).toString('base64') };
}
await writeFile('dist/server/assets.mjs', 'export const assets=' + JSON.stringify(assets) + ';\n');
await build({ entryPoints: ['server/worker.mjs'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', plugins: [{ name: 'assets', setup(builder) { builder.onResolve({ filter: /\/assets\.mjs$/ }, () => ({ path: decodeURIComponent(new URL('../dist/server/assets.mjs', import.meta.url).pathname) })); } }] });
console.log('Built SSR account and inventory app for Vercel.');
