'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const embeds = require('../../notifications/templates/discord.embeds');
const { isValidDiscordWebhook } = require('../../notifications/providers/discord.provider');
const { NotificationQueue, MAX_ATTEMPTS } = require('../../notifications/notification.queue');
const { maskWebhook, normalizeChannelInput } = require('../../services/notification.service');

const monitor = { id: 1, name: 'Meu Servidor Minecraft', target: 'play.exemplo.com:25565', groupName: 'Servidores de Jogos' };
const now = new Date('2026-11-08T22:45:30Z');

test('embed de DOWN segue o formato do Discord com título, cor e campos', () => {
  const e = embeds.monitorDown({ monitor, message: 'Timeout após 10s', timezone: 'America/Bahia', now, attempts: { current: 3, max: 3 } });
  assert.match(e.title, /🔴 Noxis Uptime — Serviço indisponível/);
  assert.equal(e.color, embeds.COLORS.down);
  assert.equal(e.footer.text, 'Noxis Uptime • Sistema de Monitoramento');
  const tentativas = e.fields.find((f) => f.name === '🔁 Tentativas');
  assert.equal(tentativas.value, '3 de 3');
  assert.ok(e.fields.every((f) => f.value.length <= 1024));
});

test('embed de recuperação calcula duração legível', () => {
  const e = embeds.monitorUp({ monitor, latencyMs: 42, downtimeSeconds: 272, timezone: 'America/Bahia', now });
  assert.equal(e.color, embeds.COLORS.up);
  assert.equal(e.fields.find((f) => f.name === '⏳ Tempo indisponível').value, '4 minutos e 32 segundos');
});

test('buildPayload inclui menções e restringe allowed_mentions', () => {
  const e = embeds.testEmbed({ channelName: 'x', timezone: 'America/Bahia', now });
  const p = embeds.buildPayload(e, { mentionUserIds: ['123456789012345678'], mentionRoleIds: ['223456789012345678'] });
  assert.equal(p.content, '<@123456789012345678> <@&223456789012345678>');
  assert.deepEqual(p.allowed_mentions.parse, []);
});

test('apenas URLs oficiais de webhook do Discord são aceitas', () => {
  assert.equal(isValidDiscordWebhook('https://discord.com/api/webhooks/123456/abc-DEF_1'), true);
  assert.equal(isValidDiscordWebhook('https://evil.example.com/api/webhooks/1/a'), false);
  assert.equal(isValidDiscordWebhook('http://discord.com/api/webhooks/1/a'), false);
});

test('maskWebhook oculta o token', () => {
  assert.equal(maskWebhook('https://discord.com/api/webhooks/123/SEGREDO'), 'https://discord.com/api/webhooks/123/••••••••');
});

test('normalizeChannelInput mantém webhook salvo quando o campo vem mascarado', () => {
  const current = { config: { webhookUrl: 'https://discord.com/api/webhooks/1/abc' } };
  const { errors, value } = normalizeChannelInput({ name: 'Canal', webhookUrl: '••••', events: ['monitor.down'] }, current);
  assert.deepEqual(errors, []);
  assert.equal(value.config.webhookUrl, current.config.webhookUrl);
});

test('fila reenvia após 429 e desiste após o limite de tentativas', async () => {
  const seen = [];
  const done = [];
  const q = new NotificationQueue({
    concurrency: 1,
    send: async (job) => {
      seen.push(job.attempts); // a fila incrementa attempts antes de cada envio
      if (job.attempts === 1) return { ok: false, status: 429, retryAfterMs: 5 };
      return { ok: true, status: 204 };
    },
    onDone: async (job, outcome) => done.push(outcome),
  });
  q.enqueue({ id: 1 });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(seen, [1, 2]);
  assert.equal(done[0].state, 'sent');
  assert.ok(MAX_ATTEMPTS >= 3);
  q.clear();
});
