'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMonitor, maskConfig, normalizeTags } = require('../../validators/monitor.validator');

const base = { name: 'Servidor', intervalSeconds: 60, timeoutSeconds: 10, retries: 2 };

test('aceita monitor HTTP válido e normaliza campos', () => {
  const { errors, value } = validateMonitor({ ...base, type: 'http', target: 'https://app.local/health', tags: 'Prod, API' });
  assert.deepEqual(errors, []);
  assert.equal(value.config.method, 'GET');
  assert.deepEqual(value.tags, ['prod', 'api']);
});

test('rejeita URL sem http(s), timeout maior que intervalo e tipo inválido', () => {
  const r = validateMonitor({ ...base, type: 'http', target: 'ftp://x', timeoutSeconds: 120 });
  assert.ok(r.errors.some((e) => e.includes('http ou https')));
  assert.ok(r.errors.some((e) => e.includes('timeout')));
  assert.ok(validateMonitor({ ...base, type: 'bogus', target: 'x' }).errors.length > 0);
});

test('tcp e ssl usam porta padrão quando ausente', () => {
  const tcp = validateMonitor({ ...base, type: 'tcp', target: '10.0.0.5', port: 25565 });
  assert.equal(tcp.value.target, '10.0.0.5:25565');
  const ssl = validateMonitor({ ...base, type: 'ssl', target: 'exemplo.com' });
  assert.equal(ssl.value.target, 'exemplo.com:443');
});

test('maskConfig oculta senhas, tokens e cabeçalhos de autorização', () => {
  const masked = maskConfig({ auth: { type: 'bearer', token: 'segredo' }, headers: { Authorization: 'Bearer x', accept: '*/*' } });
  assert.equal(masked.auth.token, '••••••••');
  assert.equal(masked.headers.Authorization, '••••••••');
  assert.equal(masked.headers.accept, '*/*');
});

test('normalizeTags remove duplicados e limita quantidade', () => {
  assert.deepEqual(normalizeTags('a, A, b,,'), ['a', 'b']);
  assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 10);
});
