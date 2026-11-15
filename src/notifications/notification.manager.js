'use strict';

const bus = require('../events/bus');
const { channelsRepo } = require('../db/repositories/notifications');
const settingsRepo = require('../db/repositories/settings');
const embeds = require('./templates/discord.embeds');
const { NotificationQueue } = require('./notification.queue');
const { buildJob, deliverJob, DEFAULT_MENTION_EVENTS } = require('./dispatch');
const audit = require('../db/repositories/audit');
const dependencyService = require('../services/dependency.service');

const DEDUPE_WINDOW_MS = 60 * 1000;
// Monitores cuja queda foi suprimida por correlação de dependências (evita recuperações órfãs).
const suppressedDown = new Set();

/** Eventos disponíveis para configuração de canais (também usados na UI). */
const EVENT_CATALOG = [
  { value: 'monitor.down', label: 'Monitor ficou offline' },
  { value: 'monitor.up', label: 'Monitor foi recuperado' },
  { value: 'monitor.latency', label: 'Latência elevada' },
  { value: 'ssl.expiring', label: 'Certificado SSL próximo do vencimento' },
  { value: 'incident.opened', label: 'Incidente aberto' },
  { value: 'incident.updated', label: 'Incidente atualizado' },
  { value: 'incident.resolved', label: 'Incidente resolvido' },
  { value: 'maintenance.started', label: 'Início de manutenção' },
  { value: 'maintenance.ended', label: 'Fim de manutenção' },
  { value: 'monitor.paused', label: 'Monitor pausado' },
  { value: 'monitor.resumed', label: 'Monitor retomado' },
  { value: 'heartbeat.missed', label: 'Falha de heartbeat' },
];

class NotificationManager {
  constructor() {
    this.recent = new Map();
    this.queue = new NotificationQueue({
      concurrency: 2,
      send: (job) => deliverJob(job),
      onDone: (job, outcome) => this.finish(job, outcome),
    });
  }

  /** Decide se um canal deve receber o evento para o monitor/grupo informado. */
  matches(channel, event, monitor) {
    if (!channel.enabled) return false;
    if (!channel.events.includes(event)) return false;
    if (monitor) {
      if (channel.monitorIds.length && !channel.monitorIds.includes(monitor.id)) return false;
      if (channel.groupIds.length && !channel.groupIds.includes(monitor.groupId)) return false;
    }
    return true;
  }

  /**
   * Publica um evento para todos os canais compatíveis.
   * Eventos idênticos dentro da janela de deduplicação são ignorados.
   */
  publish(event, { monitor = null, build }) {
    const dedupeKey = `${event}:${monitor?.id ?? 'global'}:${build.key || ''}`;
    const now = Date.now();
    for (const [k, t] of this.recent) if (now - t > DEDUPE_WINDOW_MS) this.recent.delete(k);
    if (this.recent.has(dedupeKey)) return 0;
    this.recent.set(dedupeKey, now);

    let queued = 0;
    const timezone = settingsRepo.get('timezone', 'America/Bahia');
    for (const channel of channelsRepo.listEnabled()) {
      if (!this.matches(channel, event, monitor)) continue;
      const embed = build.render(timezone);
      const mentionEvents = channel.config.mentionOn || DEFAULT_MENTION_EVENTS;
      this.queue.enqueue(buildJob(channel, event, embed, mentionEvents));
      queued += 1;
    }
    return queued;
  }

  async finish(job, outcome) {
    channelsRepo.logDelivery({
      channelId: job.channelId,
      event: job.event,
      title: job.title,
      status: outcome.state,
      httpStatus: outcome.httpStatus,
      attempts: outcome.attempts,
      error: outcome.error,
    });
    channelsRepo.recordResult(job.channelId, { ok: outcome.state !== 'failed', error: outcome.error });
    bus.emit('notification:sent', { channelId: job.channelId, event: job.event, status: outcome.state });
  }

  /** Aviso de sistema (ex.: atualização pendente): vai para todos os canais ativos. */
  broadcast(event, { key, embed }) {
    const dedupeKey = `broadcast:${event}:${key}`;
    if (this.recent.has(dedupeKey)) return 0;
    this.recent.set(dedupeKey, Date.now());
    let queued = 0;
    for (const channel of channelsRepo.listEnabled()) {
      this.queue.enqueue(buildJob(channel, event, embed, []));
      queued += 1;
    }
    return queued;
  }

  /** Envio de teste imediato (ignora filtros de evento). */
  async sendTest(channelId, userId) {
    const channel = channelsRepo.findById(channelId);
    if (!channel) return { ok: false, error: 'Canal não encontrado' };
    const timezone = settingsRepo.get('timezone', 'America/Bahia');
    const embed = embeds.testEmbed({ channelName: channel.name, timezone });
    const result = await deliverJob(buildJob(channel, 'test', embed));
    const state = result.simulated ? 'simulated' : (result.ok ? 'sent' : 'failed');
    channelsRepo.logDelivery({
      channelId, event: 'test', title: 'Teste de notificação',
      status: state, httpStatus: result.status, attempts: 1, error: result.error,
    });
    channelsRepo.recordResult(channelId, { ok: state !== 'failed', error: result.error });
    audit.write({ userId, action: 'webhook.test', entity: 'notification_channel', entityId: channelId,
      severity: state === 'failed' ? 'warning' : 'info', details: { state, status: result.status } });
    return { ...result, state };
  }
}

/** Liga o gerenciador aos eventos internos do sistema. */
function registerNotificationManager(manager) {
  bus.on('monitor:status', ({ monitor, previous, next, message, durationSeconds }) => {
    if (next === 'DOWN' && previous !== 'DOWN') {
      const decision = dependencyService.decideAlert(monitor.id);
      if (decision.action === 'suppress') {
        // Falha causada por outra dependência: o alerta de causa raiz já cobre este serviço.
        suppressedDown.add(monitor.id);
        return;
      }
      if (decision.action === 'root') {
        manager.publish('monitor.down', {
          monitor,
          build: {
            key: `${monitor.id}:root:${monitor.lastStatusChangeAt}`,
            render: (timezone) => embeds.rootCause({
              root: monitor, affected: decision.affected.map((a) => a.name), chains: decision.chains, timezone,
            }),
          },
        });
        return;
      }
      manager.publish('monitor.down', {
        monitor,
        build: {
          key: `${monitor.id}:${monitor.lastStatusChangeAt}`,
          render: (timezone) => embeds.monitorDown({
            monitor, message, timezone,
            attempts: { current: monitor.consecutiveFailures, max: monitor.retries + 1 },
            latencyLabel: /timeout/i.test(message || '') ? 'Timeout' : 'Sem resposta',
          }),
        },
      });
    }
    if (previous === 'DOWN' && (next === 'UP' || next === 'DEGRADED')) {
      if (suppressedDown.has(monitor.id)) {
        // Recuperação de um serviço cuja queda foi suprimida: não há alerta prévio para encerrar.
        suppressedDown.delete(monitor.id);
        return;
      }
      manager.publish('monitor.up', {
        monitor,
        build: {
          key: `${monitor.id}:${monitor.lastStatusChangeAt}`,
          render: (timezone) => embeds.monitorUp({
            monitor, latencyMs: monitor.lastLatencyMs, downtimeSeconds: durationSeconds, timezone,
          }),
        },
      });
    }
  });

  bus.on('monitor:latency-high', ({ monitor, latencyMs, threshold }) => {
    manager.publish('monitor.latency', {
      monitor,
      build: { key: `${monitor.id}:${Math.floor(Date.now() / 600000)}`,
        render: (tz) => embeds.latencyHigh({ monitor, latencyMs, threshold, timezone: tz }) },
    });
  });

  bus.on('monitor:ssl-expiring', ({ monitor, daysLeft, threshold }) => {
    manager.publish('ssl.expiring', {
      monitor,
      build: { key: `${monitor.id}:${threshold}`,
        render: (tz) => embeds.sslExpiring({ monitor, daysLeft, timezone: tz }) },
    });
  });

  bus.on('monitor:heartbeat-missed', ({ monitor }) => {
    manager.publish('heartbeat.missed', {
      monitor,
      build: { key: `${monitor.id}:${monitor.lastPushAt || ''}`,
        render: (tz) => embeds.heartbeatMissed({ monitor, intervalSeconds: monitor.intervalSeconds, timezone: tz }) },
    });
  });

  bus.on('monitor:paused', ({ monitor }) => {
    manager.publish('monitor.paused', {
      monitor,
      build: { key: String(Date.now()), render: (tz) => embeds.pausedResumed({ kind: 'paused', monitor, timezone: tz }) },
    });
  });
  bus.on('monitor:resumed', ({ monitor }) => {
    manager.publish('monitor.resumed', {
      monitor,
      build: { key: String(Date.now()), render: (tz) => embeds.pausedResumed({ kind: 'resumed', monitor, timezone: tz }) },
    });
  });

  bus.on('incident:opened', ({ incident, monitor }) => {
    manager.publish('incident.opened', {
      monitor,
      build: { key: `i${incident.id}`, render: (tz) => embeds.incidentEmbed({ kind: 'opened', incident, timezone: tz }) },
    });
  });
  bus.on('incident:updated', ({ incident }) => {
    manager.publish('incident.updated', {
      monitor: null,
      build: { key: `i${incident.id}:${incident.status}:${Date.now()}`,
        render: (tz) => embeds.incidentEmbed({ kind: 'updated', incident, timezone: tz }) },
    });
  });
  bus.on('incident:resolved', ({ incident, monitor }) => {
    manager.publish('incident.resolved', {
      monitor,
      build: { key: `i${incident.id}`, render: (tz) => embeds.incidentEmbed({ kind: 'resolved', incident, timezone: tz }) },
    });
  });
  bus.on('maintenance:started', ({ maintenance }) => {
    manager.publish('maintenance.started', {
      build: { key: `m${maintenance.id}`, render: (tz) => embeds.maintenanceEmbed({ kind: 'started', maintenance, timezone: tz }) },
    });
  });
  bus.on('maintenance:ended', ({ maintenance }) => {
    manager.publish('maintenance.ended', {
      build: { key: `m${maintenance.id}`, render: (tz) => embeds.maintenanceEmbed({ kind: 'ended', maintenance, timezone: tz }) },
    });
  });
  return manager;
}

module.exports = { NotificationManager, registerNotificationManager, EVENT_CATALOG, DEFAULT_MENTION_EVENTS };
