'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, generateToken, sha256 } = require('../../auth/security');

test('hash de senha com scrypt verifica a senha correta e recusa a incorreta', async () => {
  const hash = await hashPassword('SenhaForte123');
  assert.ok(hash.startsWith('scrypt$'));
  assert.notEqual(hash, await hashPassword('SenhaForte123'), 'salt deve ser aleatório');
  assert.equal(await verifyPassword('SenhaForte123', hash), true);
  assert.equal(await verifyPassword('outra', hash), false);
  assert.equal(await verifyPassword('x', 'lixo'), false);
});

test('tokens são aleatórios e só o hash é derivável', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, sha256(a.token));
  assert.equal(a.hash.length, 64);
});
