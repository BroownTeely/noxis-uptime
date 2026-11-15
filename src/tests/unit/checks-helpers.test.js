'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getStatusMatcher, jsonPathGet } = require('../../monitors/checks/helpers');

test('getStatusMatcher interpreta faixas e listas', () => {
  const def = getStatusMatcher('');
  assert.equal(def(204), true);
  assert.equal(def(301), false);
  const list = getStatusMatcher('200,301-302');
  assert.equal(list(301), true);
  assert.equal(list(404), false);
  assert.throws(() => getStatusMatcher('abc'), /inválido/);
});

test('jsonPathGet navega por chaves e índices', () => {
  const obj = { data: { items: [{ status: 'ok' }] } };
  assert.equal(jsonPathGet(obj, 'data.items.0.status'), 'ok');
  assert.equal(jsonPathGet(obj, 'data.missing.x'), undefined);
  assert.deepEqual(jsonPathGet(obj, ''), obj);
});
