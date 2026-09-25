import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { fixtureDatabase, fixtureHeaders } from './session-fixture.mjs';

test('bundled Worker exposes login assets while guarding inventory and staff pages', async () => {
  const DB = await fixtureDatabase();
  for (const path of ['/login','/owner-setup','/account.js','/account.css','/ssr-logo.jpg']) {
    const response = await worker.fetch(new Request('https://ssr.example'+path),{DB});
    assert.equal(response.status,200,path); assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
  for (const path of ['/','/index.html','/users','/password']) {
    const response = await worker.fetch(new Request('https://ssr.example'+path),{DB});
    assert.equal(response.status,302,path); assert.equal(response.headers.get('location'),'/login');
  }
  assert.equal((await worker.fetch(new Request('https://ssr.example/api/state'),{DB})).status,401);
  assert.equal((await worker.fetch(new Request('https://ssr.example/api/users'),{DB})).status,401);
  assert.equal((await worker.fetch(new Request('https://ssr.example/users',{headers:fixtureHeaders}),{DB})).status,403);
  const inventory=await worker.fetch(new Request('https://ssr.example/',{headers:fixtureHeaders}),{DB});
  assert.equal(inventory.status,200); assert.match(await inventory.text(),/account.js/);
  DB.close();
});
