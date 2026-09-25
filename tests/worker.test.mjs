import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.js';

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, ''));

test('existing Worker, assets, URLs and actual D1 binding configuration', () => {
  assert.equal(config.name, 'kicks-website');
  assert.equal(config.main, 'worker/index.js');
  assert.equal(config.assets.directory, './dist');
  assert.deepEqual(config.assets.run_worker_first, ['/api/visits']);
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, true);
  assert.equal(config.keep_vars, true);
  assert.equal('routes' in config, false);
  assert.equal('route' in config, false);
  assert.deepEqual(config.d1_databases, [{
    binding: 'VISITS_DB', database_name: 'kicks-visits',
    database_id: 'bc3cc827-6e9c-43b1-a092-f40636eded48', migrations_dir: 'migrations',
  }]);
});

test('only exact API path uses existing visit handler (including query strings)', async () => {
  const env = { ASSETS: { fetch() { throw Error('API must not fall through to assets'); } } };
  for (const path of ['/api/visits', '/api/visits?check=1']) {
    const response = await worker.fetch(new Request(`https://kicksuiuc.com${path}`), env);
    assert.equal(response.status, 503); // deliberately absent local DB binding
    assert.deepEqual(await response.json(), { unavailable: true });
  }
});

test('static paths preserve request and response through ASSETS fallback', async () => {
  for (const path of ['/', '/about/', '/league/FA26-L1', '/_astro/app.js', '/missing', '/api/visits/']) {
    const request = new Request(`https://kicksuiuc.com${path}`);
    const expected = new Response('asset', { status: path === '/missing' ? 404 : 200 });
    const env = { ASSETS: { fetch(actual) { assert.equal(actual, request); return expected; } } };
    assert.equal(await worker.fetch(request, env), expected);
  }
});
