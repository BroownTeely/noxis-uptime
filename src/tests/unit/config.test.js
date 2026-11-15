'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('porta padrão do sistema é 8417 quando PORT não é definida', () => {
  const saved = process.env.PORT;
  delete process.env.PORT;
  delete require.cache[require.resolve('../../config')];
  const config = require('../../config');
  assert.equal(config.port, 8417);
  if (saved !== undefined) process.env.PORT = saved;
  delete require.cache[require.resolve('../../config')];
});
