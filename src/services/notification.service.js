'use strict';

const { isValidDiscordWebhook } = require('../notifications/providers/discord.provider');
const { publishUrl } = require('../notifications/providers/ntfy.provider');
const { EVENT_CATALOG } = require('../notifications/notification.manager');

const SNOWFLAKE = /^\d{5,25}$/;
const MASK = '••••••••';
const { TOKEN_RE, CHAT_RE } = require('../notifications/providers/telegram.provider');

const CHANNEL_TYPES = ['discord', 'ntfy', 'webhook', 'telegram'];
const TYPE_LABELS = { discord: 'Discord', ntfy: 'ntfy', webhook: 'Webhook HTTP', telegram: 'Telegram' };

/** Oculta o token do webhook do Discord. */
function maskWebhook(url) {
  if (!url) return '';
  const m = /^(https:\/\/[^/]+\/api\/webhooks\/\d+)\/[\w-]+$/.exec(url);
  return m ? `${m[1]}/${MASK}` : MASK;
}

/** URL http(s) sem credenciais embutidas. Retorna null se inválida. */
function plainHttpUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

const idList = (raw, max = 50) => (Array.isArray(raw) ? raw : [])
  .map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, max);

const snowflakeList = (raw) => (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/))
  .map((v) => String(v).trim()).filter(Boolean);

const isMasked = (v) => !v || String(v).includes('••');

/**
 * Valida o payload de um canal. Em edição, segredos ausentes ou mascarados
 * mantêm o valor já salvo (o usuário não precisa reenviar tokens).
 */
function normalizeChannelInput(body = {}, current = null) {
  const errors = [];
  const type = body.type ? String(body.type) : (current?.type || 'discord');
  if (!CHANNEL_TYPES.includes(type)) errors.push('Tipo de canal inválido.');
  const prev = current?.config || {};
  const name = String(body.name || '').trim().slice(0, 80);
  if (name.length < 2) errors.push('Informe um nome para o canal.');

  let config = {};
  if (type === 'discord') {
    let webhookUrl = prev.webhookUrl || '';
    const incoming = String(body.webhookUrl || '').trim();
    if (!isMasked(incoming)) {
      if (!isValidDiscordWebhook(incoming)) errors.push('URL de webhook do Discord inválida.');
      else webhookUrl = incoming;
    }
    if (!webhookUrl) errors.push('Informe a URL do webhook.');
    const mentionUserIds = snowflakeList(body.mentionUserIds);
    const mentionRoleIds = snowflakeList(body.mentionRoleIds);
    if ([...mentionUserIds, ...mentionRoleIds].some((id) => !SNOWFLAKE.test(id))) {
      errors.push('IDs de menção devem ser numéricos (IDs do Discord).');
    }
    const validEvents = EVENT_CATALOG.map((e) => e.value);
    config = {
      webhookUrl,
      mentionUserIds: mentionUserIds.slice(0, 20),
      mentionRoleIds: mentionRoleIds.slice(0, 20),
      mentionOn: (Array.isArray(body.mentionOn) ? body.mentionOn : []).filter((e) => validEvents.includes(e)),
    };
  } else if (type === 'ntfy') {
    const serverUrl = plainHttpUrl(body.serverUrl);
    if (!serverUrl) errors.push('URL do servidor ntfy inválida (ex.: http://ntfy.lan:8080).');
    const topic = String(body.topic || '').trim();
    try {
      publishUrl({ serverUrl: serverUrl || 'http://invalido', topic });
    } catch (_) {
      errors.push('Tópico inválido (use letras, números, _ e -).');
    }
    const token = isMasked(body.token) ? (prev.token || '') : String(body.token).trim().slice(0, 300);
    const priority = Math.min(5, Math.max(1, Number.parseInt(body.priority, 10) || 4));
    config = { serverUrl: serverUrl || '', topic, token, priority };
  } else if (type === 'telegram') {
    const botToken = isMasked(body.botToken) ? (prev.botToken || '') : String(body.botToken).trim();
    if (!TOKEN_RE.test(botToken)) errors.push('Token do bot inválido (formato 123456:ABC...).');
    const chatId = String(body.chatId || '').trim();
    if (!CHAT_RE.test(chatId)) errors.push('ID do chat inválido (número ou @canal).');
    config = { botToken, chatId };
  } else if (type === 'webhook') {
    const url = plainHttpUrl(body.url);
    if (!url) errors.push('URL do webhook inválida (use http ou https).');
    const secret = isMasked(body.secret) ? (prev.secret || '') : String(body.secret).trim().slice(0, 200);
    config = { url: url || '', secret };
  }

  const validEvents = EVENT_CATALOG.map((e) => e.value);
  const events = (Array.isArray(body.events) ? body.events : []).filter((e) => validEvents.includes(e));
  if (!events.length) errors.push('Selecione ao menos um evento.');

  return {
    errors,
    value: {
      name, type, config, events,
      monitorIds: idList(body.monitorIds),
      groupIds: idList(body.groupIds),
      enabled: body.enabled !== false && body.enabled !== 'false',
    },
  };
}

/** Versão segura do canal para a interface e a API: nenhum segredo sai do servidor. */
function presentChannel(channel) {
  if (!channel) return null;
  const cfg = { ...channel.config };
  let summary = '';
  if (channel.type === 'discord') {
    summary = maskWebhook(cfg.webhookUrl);
    cfg.webhookUrl = summary;
  } else if (channel.type === 'ntfy') {
    summary = `${cfg.serverUrl} / ${cfg.topic}`;
    cfg.token = cfg.token ? MASK : '';
  } else if (channel.type === 'webhook') {
    try { summary = new URL(cfg.url).host; } catch (_) { summary = ''; }
    cfg.secret = cfg.secret ? MASK : '';
  } else if (channel.type === 'telegram') {
    summary = `chat ${cfg.chatId}`;
    cfg.botToken = cfg.botToken ? MASK : '';
  }
  return { ...channel, config: cfg, typeLabel: TYPE_LABELS[channel.type] || channel.type, summary };
}

module.exports = { maskWebhook, normalizeChannelInput, presentChannel, CHANNEL_TYPES, TYPE_LABELS };
