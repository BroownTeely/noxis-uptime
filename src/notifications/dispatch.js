'use strict';

const embeds = require('./templates/discord.embeds');
const { sendDiscord } = require('./providers/discord.provider');
const { sendNtfy } = require('./providers/ntfy.provider');
const { sendWebhook } = require('./providers/webhook.provider');
const { sendTelegram } = require('./providers/telegram.provider');
const settingsRepo = require('../db/repositories/settings');

const DEFAULT_MENTION_EVENTS = ['monitor.down', 'heartbeat.missed', 'incident.opened'];

/**
 * Modo de simulação: NOXIS_NOTIFY_DRY_RUN=true registra as entregas como "simulated"
 * sem contatar nenhum destino. Útil para testes e para validar regras sem internet.
 */
const isSimulated = () => process.env.NOXIS_NOTIFY_DRY_RUN === 'true';

/** Converte o embed em mensagem genérica (usada por ntfy e webhook). */
function genericFromEmbed(embed, event) {
  return {
    event,
    title: embed.title,
    description: embed.description || '',
    fields: (embed.fields || []).map((f) => ({ name: f.name, value: f.value })),
    severity: embed.color === embeds.COLORS.down ? 'critical'
      : embed.color === embeds.COLORS.up ? 'resolved' : 'info',
    timestamp: embed.timestamp,
  };
}

/** Monta o trabalho de envio para um canal. A configuração fica apenas em memória. */
function buildJob(channel, event, embed, mentionEvents = DEFAULT_MENTION_EVENTS) {
  const base = { channelId: channel.id, channelType: channel.type, event, title: embed.title, config: channel.config };
  if (channel.type === 'discord') {
    const mentions = mentionEvents.includes(event)
      ? { mentionUserIds: channel.config.mentionUserIds || [], mentionRoleIds: channel.config.mentionRoleIds || [] }
      : {};
    return { ...base, payload: embeds.buildPayload(embed, mentions) };
  }
  return { ...base, payload: genericFromEmbed(embed, event) };
}

async function deliverJob(job) {
  if (isSimulated()) return { ok: true, simulated: true, status: 0 };
  const settings = settingsRepo.all();
  const allowPrivate = !!settings.allowPrivateNetworks;
  switch (job.channelType) {
    case 'discord': return sendDiscord(job.config.webhookUrl, job.payload);
    case 'ntfy': return sendNtfy(job.config, job.payload, { allowPrivate });
    case 'webhook': return sendWebhook(job.config, job.payload, { allowPrivate, event: job.event });
    case 'telegram': return sendTelegram(job.config, job.payload);
    default: return { ok: false, permanent: true, error: 'Tipo de canal não suportado' };
  }
}

module.exports = { buildJob, deliverJob, genericFromEmbed, isSimulated, DEFAULT_MENTION_EVENTS };
