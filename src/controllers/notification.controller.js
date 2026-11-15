'use strict';

const { asyncHandler, toId, HttpError } = require('../utils/http');
const { channelsRepo } = require('../db/repositories/notifications');
const audit = require('../db/repositories/audit');
const { isValidDiscordWebhook } = require('../notifications/providers/discord.provider');
const { EVENT_CATALOG, DEFAULT_MENTION_EVENTS } = require('../notifications/notification.manager');
const { normalizeChannelInput, presentChannel } = require('../services/notification.service');

const present = presentChannel;

/** Controlador de canais de notificação (webhooks Discord). */
function createNotificationController(notificationManager) {
  return {
    catalog: (req, res) => res.json({ events: EVENT_CATALOG, defaultMentionEvents: DEFAULT_MENTION_EVENTS }),

    list: (req, res) => res.json({ channels: channelsRepo.list().map(present) }),

    get: asyncHandler(async (req, res) => {
      const channel = channelsRepo.findById(toId(req.params.id));
      if (!channel) throw new HttpError(404, 'Canal não encontrado');
      res.json({ channel: present(channel), log: channelsRepo.recentLog(channel.id, 30) });
    }),

    create: asyncHandler(async (req, res) => {
      const { value, errors } = normalizeChannelInput(req.body, null);
      if (errors.length) throw new HttpError(422, errors.join(' '));
      const channel = channelsRepo.create(value);
      audit.write({ userId: req.user.id, username: req.user.username, action: 'webhook.created', entity: 'notification_channel',
        entityId: channel.id, details: { name: channel.name, events: channel.events }, ip: req.ip });
      res.status(201).json({ channel: present(channel) });
    }),

    update: asyncHandler(async (req, res) => {
      const id = toId(req.params.id);
      const current = channelsRepo.findById(id);
      if (!current) throw new HttpError(404, 'Canal não encontrado');
      const { value, errors } = normalizeChannelInput(req.body, current);
      if (errors.length) throw new HttpError(422, errors.join(' '));
      const channel = channelsRepo.update(id, value);
      audit.write({ userId: req.user.id, username: req.user.username, action: 'webhook.updated', entity: 'notification_channel',
        entityId: id, ip: req.ip });
      res.json({ channel: present(channel) });
    }),

    remove: asyncHandler(async (req, res) => {
      const id = toId(req.params.id);
      if (!channelsRepo.findById(id)) throw new HttpError(404, 'Canal não encontrado');
      channelsRepo.remove(id);
      audit.write({ userId: req.user.id, username: req.user.username, action: 'webhook.deleted', severity: 'notice',
        entity: 'notification_channel', entityId: id, ip: req.ip });
      res.json({ ok: true });
    }),

    test: asyncHandler(async (req, res) => {
      const id = toId(req.params.id);
      if (!channelsRepo.findById(id)) throw new HttpError(404, 'Canal não encontrado');
      const result = await notificationManager.sendTest(id, req.user.id);
      res.json({ ok: result.ok, state: result.state, status: result.status, error: result.error || null });
    }),

    /** Pré-visualização do embed sem enviar. */
    preview: asyncHandler(async (req, res) => {
      const { buildPayload, monitorDown, monitorUp, incidentEmbed, sslExpiring } = require('../notifications/templates/discord.embeds');
      const settingsRepo = require('../db/repositories/settings');
      const tz = settingsRepo.get('timezone', 'America/Bahia');
      const kind = req.body.kind;
      const sample = { id: 0, name: String(req.body.serviceName || 'Meu Servidor Minecraft').slice(0, 80),
        target: String(req.body.target || 'play.exemplo.com:25565').slice(0, 120), groupName: String(req.body.groupName || 'Servidores de Jogos').slice(0, 80) };
      let embed;
      if (kind === 'up') embed = monitorUp({ monitor: sample, latencyMs: 42, downtimeSeconds: 272, timezone: tz });
      else if (kind === 'ssl') embed = sslExpiring({ monitor: sample, daysLeft: 9, timezone: tz });
      else if (kind === 'incident') embed = incidentEmbed({ kind: 'opened', incident: { title: 'Serviço indisponível', description: 'Falha confirmada', status: 'investigating', severity: 'critical', monitorName: sample.name }, timezone: tz });
      else embed = monitorDown({ monitor: sample, message: 'Timeout após 10s', timezone: tz, attempts: { current: 3, max: 3 }, latencyLabel: 'Timeout' });
      res.json({ payload: buildPayload(embed, {}) });
    }),

    isValidWebhook: (url) => isValidDiscordWebhook(url),
  };
}

module.exports = { createNotificationController };
