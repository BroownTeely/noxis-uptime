'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../services/discovery.service');

test('preset "common" inclui portas conhecidas e nomes de serviço', () => {
  const ports = D.parsePorts('common');
  assert.ok(ports.includes(22) && ports.includes(25565) && ports.includes(8123));
  assert.equal(D.serviceName(25565), 'Minecraft');
  assert.equal(D.serviceName(4242), 'Desconhecido');
});

test('aceita lista e faixas, ordena e remove duplicados', () => {
  assert.deepEqual(D.parsePorts('443, 22 80-82 80'), [22, 80, 81, 82, 443]);
});

test('rejeita portas inválidas, faixas invertidas e faixas grandes', () => {
  assert.throws(() => D.parsePorts('0'), /inválida|inválida/);
  assert.throws(() => D.parsePorts('70000'), /inválida/);
  assert.throws(() => D.parsePorts('100-10'), /inválida/);
  assert.throws(() => D.parsePorts('1-5000'), /Faixa grande demais/);
  assert.throws(() => D.parsePorts('1-500,501-1000'), /Máximo de 200/);
});

test('entradas com caracteres de injeção são recusadas', () => {
  assert.throws(() => D.parsePorts('22;rm -rf /'), /inválida/);
  assert.throws(() => D.parsePorts('$(id)'), /inválida/);
});
