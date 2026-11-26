import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROGRAMA, disparar } from '../src/index.js';

const env = { GITHUB_TOKEN: 'token-de-prueba', REPOSITORIO: 'alter-lego/api-boe', RAMA: 'main' };

test('cada cron de wrangler.toml tiene workflow, y al revés', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const crons = JSON.parse(toml.match(/^crons\s*=\s*(\[.*\])$/m)[1]);
  assert.deepEqual([...crons].sort(), Object.keys(PROGRAMA).sort());
});

test('lanza el workflow correcto con la rama main', async () => {
  let llamada;
  const f = async (url, op) => { llamada = { url, op }; return new Response(null, { status: 204 }); };
  assert.equal(await disparar('30 5-9 * * 1-6', env, f), 'ingesta.yml');
  assert.equal(llamada.url, 'https://api.github.com/repos/alter-lego/api-boe/actions/workflows/ingesta.yml/dispatches');
  assert.equal(llamada.op.method, 'POST');
  assert.equal(llamada.op.headers.Authorization, 'Bearer token-de-prueba');
  assert.deepEqual(JSON.parse(llamada.op.body), { ref: 'main' });
  assert.equal(await disparar('0 10 * * *', env, f), 'monitor-ingesta.yml');
});

test('falla si GitHub no acepta, si falta el token o si el cron no se conoce', async () => {
  const f = async () => new Response('Bad credentials', { status: 401 });
  await assert.rejects(disparar('30 13 * * *', env, f), /401/);
  await assert.rejects(disparar('30 13 * * *', { ...env, GITHUB_TOKEN: '' }, f), /GITHUB_TOKEN/);
  await assert.rejects(disparar('* * * * *', env, f), /sin workflow/);
});
