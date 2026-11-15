'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIp, parseHostPort, isSafeHostToken, assertSafeHost, BlockedTargetError } = require('../../utils/network');

test('classifica IPs privados, públicos e bloqueados', () => {
  assert.equal(classifyIp('10.1.2.3'), 'private');
  assert.equal(classifyIp('192.168.0.10'), 'private');
  assert.equal(classifyIp('127.0.0.1'), 'private');
  assert.equal(classifyIp('8.8.8.8'), 'public');
  assert.equal(classifyIp('169.254.169.254'), 'always');
  assert.equal(classifyIp('224.0.0.1'), 'always');
  assert.equal(classifyIp('::ffff:169.254.169.254'), 'always');
  assert.equal(classifyIp('::1'), 'private');
});

test('assertSafeHost bloqueia metadados sempre e privados quando desativado', async () => {
  await assert.rejects(assertSafeHost('169.254.169.254', { allowPrivate: true }), BlockedTargetError);
  await assert.rejects(assertSafeHost('192.168.1.5', { allowPrivate: false }), BlockedTargetError);
  const ok = await assertSafeHost('192.168.1.5', { allowPrivate: true });
  assert.deepEqual(ok, ['192.168.1.5']);
});

test('parseHostPort aceita host, host:porta e IPv6 entre colchetes', () => {
  assert.deepEqual(parseHostPort('exemplo.com:8443', 443), { host: 'exemplo.com', port: 8443 });
  assert.deepEqual(parseHostPort('exemplo.com', 443), { host: 'exemplo.com', port: 443 });
  assert.deepEqual(parseHostPort('[::1]:22', 80), { host: '::1', port: 22 });
  assert.throws(() => parseHostPort('x:99999', 1), /Porta inválida/);
});

test('isSafeHostToken rejeita caracteres de injeção', () => {
  assert.equal(isSafeHostToken('servidor-01.local'), true);
  assert.equal(isSafeHostToken('a;rm -rf /'), false);
  assert.equal(isSafeHostToken('$(whoami)'), false);
});
