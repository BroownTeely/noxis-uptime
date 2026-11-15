'use strict';

const bus = require('../events/bus');
const monitorsRepo = require('../db/repositories/monitors');
const { checksRepo, eventsRepo } = require('../db/repositories/checks');
const settingsRepo = require('../db/repositories/settings');
const { getChecker } = require('./checks');
const { getDatabase } = require('../db/connection');

const PUSH_GRACE_SECONDS = 30;
const WATCHDOG_MS = 15000;
const RETENTION_MS = 6 * 60 * 60 * 1000;
const SSL_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LATENCY_ALERT_COOLDOWN_MS = 10 * 60 * 1000;

const nowIso = () => new Date().toISOString();
const secondsBetween = (fromIso, toMs = Date.now()) => {
  if (!fromIso) return null;
  return Math.max(0, Math.round((toMs - new Date(fromIso).getTime()) / 1000));
};

function withTimeout(runner, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, latencyMs: null, message: `Timeout após ${Math.round(ms / 1000)}s`, details: {} });
    }, ms);
  });
  return Promise.race([
    Promise.resolve().then(() => runner(controller.signal)).catch((err) => ({
      ok: false, latencyMs: null, message: err.message || 'Erro interno', details: {},
    })),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

/**
 * Motor central de monitoramento.
 *  - Um timer por monitor (setTimeout encadeado), nunca setInterval por tarefa.
 *  - Fila com limite de concorrência global.
 *  - Impede execução duplicada do mesmo monitor.
 *  - Aplica a máquina de estados (UP, DOWN, PENDING, DEGRADED, PAUSED, MAINTENANCE)
 *    com tentativas configuráveis antes de declarar falha.
 */
class MonitorEngine {
  constructor({ maxConcurrent, isInMaintenance = () => false }) {
    this.maxConcurrent = maxConcurrent;
    this.isInMaintenance = isInMaintenance;
    this.timers = new Map();
    this.queue = [];
    this.queued = new Set();
    this.running = new Set();
    this.activeRuns = 0;
    this.started = false;
    this.lastAlerts = new Map();
    this.watchdog = null;
    this.retention = null;
    this.stats = { checks: 0, failures: 0, startedAt: null };
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.stats.startedAt = nowIso();
    for (const monitor of monitorsRepo.activeMonitors()) {
      const jitter = Math.floor(Math.random() * Math.min(5000, monitor.intervalSeconds * 250));
      this.schedule(monitor.id, jitter);
    }
    this.watchdog = setInterval(() => this.checkPushMonitors(), WATCHDOG_MS);
    this.watchdog.unref();
    this.retention = setInterval(() => this.applyRetention(), RETENTION_MS);
    this.retention.unref();
    setTimeout(() => this.applyRetention(), 5000).unref();
  }

  stop() {
    this.started = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.queue.length = 0;
    this.queued.clear();
    clearInterval(this.watchdog);
    clearInterval(this.retention);
  }

  /** Aguarda as verificações em andamento terminarem (até timeoutMs). */
  async drain(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (this.running.size && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  schedule(monitorId, delayMs) {
    clearTimeout(this.timers.get(monitorId));
    const timer = setTimeout(() => {
      this.timers.delete(monitorId);
      this.enqueue(monitorId);
    }, Math.max(0, delayMs));
    timer.unref();
    this.timers.set(monitorId, timer);
    const next = new Date(Date.now() + Math.max(0, delayMs)).toISOString();
    try {
      monitorsRepo.saveCheckState(monitorId, { nextCheckAt: next });
    } catch (_) { /* monitor removido durante o agendamento */ }
  }

  unschedule(monitorId) {
    clearTimeout(this.timers.get(monitorId));
    this.timers.delete(monitorId);
    this.queued.delete(monitorId);
  }

  /** Reinicia o agendamento de um monitor após alteração de configuração. */
  reschedule(monitorId) {
    this.unschedule(monitorId);
    const monitor = monitorsRepo.findById(monitorId);
    if (monitor?.active) this.schedule(monitorId, 0);
  }

  runNow(monitorId) {
    this.enqueue(monitorId);
  }

  enqueue(monitorId) {
    if (this.queued.has(monitorId) || this.running.has(monitorId)) return;
    this.queued.add(monitorId);
    this.queue.push(monitorId);
    this.drainQueue();
  }

  drainQueue() {
    while (this.activeRuns < this.maxConcurrent && this.queue.length) {
      const id = this.queue.shift();
      this.queued.delete(id);
      this.activeRuns += 1;
      this.running.add(id);
      this.execute(id).finally(() => {
        this.running.delete(id);
        this.activeRuns -= 1;
        this.drainQueue();
      });
    }
  }

  async execute(monitorId) {
    const monitor = monitorsRepo.findById(monitorId);
    if (!monitor || !monitor.active) return;

    const checker = getChecker(monitor.type);
    if (!checker) {
      // Push é avaliado pelo watchdog, não por execução ativa.
      return;
    }

    const settings = settingsRepo.all();
    const timeoutMs = Math.max(1, monitor.timeoutSeconds) * 1000;
    const result = await withTimeout(
      (signal) => checker(monitor, { signal, allowPrivate: !!settings.allowPrivateNetworks, warnDays: settings.sslWarnDays }),
      timeoutMs
    );
    this.stats.checks += 1;
    if (!result.ok) this.stats.failures += 1;

    this.applyResult(monitor, result, settings);
  }

  /**
   * Aplica o resultado de uma verificação: grava histórico, calcula o novo estado,
   * dispara eventos apenas em transições e agenda a próxima execução.
   */
  applyResult(monitor, result, settings = settingsRepo.all()) {
    const checkedAt = nowIso();
    const maintenance = this.isInMaintenance(monitor);
    const failures = result.ok ? 0 : (monitor.consecutiveFailures || 0) + 1;
    const attemptsAllowed = (monitor.retries || 0) + 1;

    let next;
    if (maintenance) next = 'MAINTENANCE';
    else if (result.ok) {
      const threshold = monitor.latencyThresholdMs ?? settings.latencyThresholdMs;
      next = threshold && result.latencyMs !== null && result.latencyMs > threshold ? 'DEGRADED' : 'UP';
    } else if (failures >= attemptsAllowed || monitor.status === 'DOWN') next = 'DOWN';
    else next = 'PENDING';

    checksRepo.insert({
      monitorId: monitor.id, checkedAt, ok: result.ok, status: next,
      latencyMs: result.latencyMs, message: result.message, details: result.details,
    });

    const previous = monitor.status;
    const changed = previous !== next;
    const patch = {
      status: next,
      consecutiveFailures: failures,
      lastLatencyMs: result.latencyMs ?? null,
      lastMessage: result.message || null,
      lastCheckAt: checkedAt,
    };
    if (changed) patch.lastStatusChangeAt = checkedAt;
    monitorsRepo.saveCheckState(monitor.id, patch);

    const updated = monitorsRepo.findById(monitor.id);
    if (changed) {
      const duration = secondsBetween(monitor.lastStatusChangeAt);
      eventsRepo.insert({
        monitorId: monitor.id, previousStatus: previous, newStatus: next,
        message: result.message, durationSeconds: duration, createdAt: checkedAt,
      });
      bus.emit('monitor:status', {
        monitor: updated, previous, next, message: result.message,
        durationSeconds: duration, details: result.details || {}, checkedAt,
      });
    }

    bus.emit('monitor:checked', { monitor: updated, result, checkedAt });
    bus.emit('monitor:changed', { monitor: updated });

    this.emitAlerts(updated, result, settings);

    if (monitor.type !== 'push') {
      const delay = !result.ok && next !== 'DOWN' && next !== 'MAINTENANCE'
        ? Math.min(monitor.intervalSeconds, 20) * 1000
        : monitor.intervalSeconds * 1000;
      this.schedule(monitor.id, delay);
    }
    return updated;
  }

  emitAlerts(monitor, result, settings) {
    const now = Date.now();
    const key = (name) => `${name}:${monitor.id}`;

    if (monitor.type === 'ssl' && result.details?.daysLeft !== undefined && result.details?.daysLeft !== null) {
      // Alerta a cada degrau mais urgente: 30 -> 14 -> 7 -> 3 -> 1 dias. Renovação reinicia o ciclo.
      const days = result.details.daysLeft;
      const steps = (settings.sslAlertDays || [30, 14, 7, 3, 1]).map(Number).filter((n) => n > 0);
      const crossed = steps.filter((t) => days <= t);
      const key = `ssl-step:${monitor.id}`;
      if (!crossed.length) {
        this.lastAlerts.delete(key);
      } else {
        const level = Math.min(...crossed);
        const last = this.lastAlerts.get(key);
        if (last === undefined || level < last) {
          this.lastAlerts.set(key, level);
          bus.emit('monitor:ssl-expiring', { monitor, daysLeft: days, threshold: level });
        }
      }
    }

    const threshold = monitor.latencyThresholdMs ?? settings.latencyThresholdMs;
    if (result.ok && threshold && result.latencyMs > threshold) {
      const last = this.lastAlerts.get(key('lat')) || 0;
      if (now - last > LATENCY_ALERT_COOLDOWN_MS) {
        this.lastAlerts.set(key('lat'), now);
        bus.emit('monitor:latency-high', { monitor, latencyMs: result.latencyMs, threshold });
      }
    }
  }

  /** Recebe um sinal de heartbeat (monitor do tipo push). */
  receivePush(token, { ok = true, message } = {}) {
    const monitor = monitorsRepo.findByPushToken(token);
    if (!monitor || monitor.type !== 'push') return null;
    if (!monitor.active) return { monitor, accepted: false };
    const checkedAt = nowIso();
    monitorsRepo.saveCheckState(monitor.id, { lastPushAt: checkedAt });
    const fresh = monitorsRepo.findById(monitor.id);
    const result = {
      ok,
      latencyMs: null,
      message: message || (ok ? 'Sinal recebido' : 'Sinal de falha recebido'),
      details: { source: 'push' },
    };
    this.applyResult(fresh, result);
    return { monitor: monitorsRepo.findById(monitor.id), accepted: true };
  }

  /** Verifica monitores push atrasados. Dispara falha somente na primeira detecção. */
  checkPushMonitors() {
    const now = Date.now();
    for (const monitor of monitorsRepo.activeMonitors()) {
      if (monitor.type !== 'push') continue;
      if (this.isInMaintenance(monitor)) continue;
      const baseline = monitor.lastPushAt || monitor.createdAt;
      const deadline = new Date(baseline).getTime() + (monitor.intervalSeconds + PUSH_GRACE_SECONDS) * 1000;
      if (now < deadline) continue;
      if (monitor.status === 'DOWN') continue;
      bus.emit('monitor:heartbeat-missed', { monitor });
      this.applyResult(monitor, {
        ok: false, latencyMs: null,
        message: `Heartbeat não recebido em ${monitor.intervalSeconds}s`,
        details: { source: 'push', lastPushAt: monitor.lastPushAt },
      });
    }
  }

  applyRetention() {
    const days = Math.max(1, Number(settingsRepo.get('retentionDays', 90)) || 90);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    try {
      const removedChecks = checksRepo.purgeOlderThan(cutoff);
      const removedEvents = eventsRepo.purgeOlderThan(cutoff);
      if (removedChecks || removedEvents) {
        getDatabase().exec('PRAGMA incremental_vacuum;');
      }
    } catch (err) {
      bus.emit('system:error', { scope: 'retention', error: err });
    }
  }

  /** Pausa ou retoma um monitor. */
  setActive(monitorId, active) {
    const monitor = monitorsRepo.setActive(monitorId, active);
    if (!monitor) return null;
    if (active) {
      this.schedule(monitorId, 0);
      bus.emit('monitor:resumed', { monitor });
    } else {
      this.unschedule(monitorId);
      bus.emit('monitor:paused', { monitor });
    }
    bus.emit('monitor:changed', { monitor });
    return monitor;
  }

  snapshot() {
    return {
      scheduled: this.timers.size,
      queued: this.queue.length,
      running: this.activeRuns,
      maxConcurrent: this.maxConcurrent,
      totalChecks: this.stats.checks,
      totalFailures: this.stats.failures,
      startedAt: this.stats.startedAt,
    };
  }
}

module.exports = { MonitorEngine, withTimeout, secondsBetween };
