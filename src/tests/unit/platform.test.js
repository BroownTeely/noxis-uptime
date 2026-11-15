'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mapService = require('../../services/map.service');
const { normalizeChannelInput } = require('../../services/notification.service');
const { textFromPayload } = require('../../notifications/providers/telegram.provider');
const { validateMonitor, maskConfig } = require('../../validators/monitor.validator');

function sample() {
  const nodes = new Map([
    [1, { id: 1, name: 'PostgreSQL', status: 'DOWN', active: true }],
    [2, { id: 2, name: 'API', status: 'UP', active: true }],
    [3, { id: 3, name: 'Site', status: 'UP', active: true }],
    [4, { id: 4, name: 'CDN', status: 'UP', active: true }],
  ]);
  const edges = [
    { from: 2, to: 1, required: true },
    { from: 3, to: 2, required: true },
    { from: 3, to: 4, required: false },
  ];
  return { nodes, edges };
}

test('mapa: aplicações no topo, dependências abaixo, opcionais marcadas', () => {
  const m = mapService.build(sample());
  const byName = Object.fromEntries(m.nodes.map((n) => [n.name, n]));
  assert.equal(byName.Site.level, 0);
  assert.equal(byName.API.level, 1);
  assert.equal(byName.PostgreSQL.level, 2);
  assert.equal(byName.CDN.level, 1);
  assert.ok(byName.PostgreSQL.y > byName.API.y && byName.API.y > byName.Site.y, 'níveis descem na tela');
  assert.equal(byName.PostgreSQL.state, 'DOWN');
  // API depende do PostgreSQL que está DOWN: estado derivado DEGRADED
  assert.equal(byName.API.state, 'DEGRADED');
  assert.equal(m.edges.filter((e) => !e.required).length, 1);
});

test('mapa: grafo vazio não quebra', () => {
  const m = mapService.build({ nodes: new Map(), edges: [] });
  assert.equal(m.nodes.length, 0);
  assert.ok(m.width >= 960);
});

test('telegram: valida token do bot e ID do chat', () => {
  const ok = normalizeChannelInput({ type: 'telegram', name: 'Bot', botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', chatId: '-1001234567890', events: ['monitor.down'] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value.type, 'telegram');
  const bad = normalizeChannelInput({ type: 'telegram', name: 'Bot', botToken: 'nao-e-token', chatId: 'x y', events: ['monitor.down'] });
  assert.ok(bad.errors.some((e) => /Token do bot/.test(e)));
  assert.ok(bad.errors.some((e) => /ID do chat/.test(e)));
});

test('telegram: texto da mensagem inclui título, descrição e campos', () => {
  const text = textFromPayload({ title: 'Serviço indisponível', description: 'API caiu', fields: [{ name: 'Status', value: 'DOWN' }] });
  assert.equal(text, 'Serviço indisponível\nAPI caiu\nStatus: DOWN');
});

test('api: aceita métodos e API key, recusa corpo que não é JSON', () => {
  const ok = validateMonitor({ name: 'Login API', type: 'api', target: 'https://api.local/login', method: 'PATCH',
    requestBody: '{"user":"x"}', authType: 'apikey', authApiKeyName: 'X-Api-Key', authApiKeyValue: 'segredo-123', requiredKeys: 'status, data' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value.config.method, 'PATCH');
  assert.equal(ok.value.config.auth.type, 'apikey');
  assert.deepEqual(ok.value.config.requiredKeys, 'status, data');
  const bad = validateMonitor({ name: 'Login API', type: 'api', target: 'https://api.local/login', requestBody: '{nao json' });
  assert.ok(bad.errors.some((e) => /JSON válido/.test(e)));
});

test('api: API key nunca aparece na configuração exibida', () => {
  const masked = maskConfig({ auth: { type: 'apikey', name: 'X-Api-Key', value: 'segredo-123' } });
  assert.equal(masked.auth.value, '••••••••');
  assert.equal(masked.auth.name, 'X-Api-Key');
});
