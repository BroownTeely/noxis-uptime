'use strict';

const os = require('os');
const { Server } = require('socket.io');
const bus = require('../events/bus');
const config = require('../config');
const { parseCookies } = require('../utils/cookies');
const { SESSION_COOKIE } = require('../middleware/auth');
const { sha256 } = require('../auth/security');
const sessionsRepo = require('../db/repositories/sessions');
const { dashboardService } = require('../services/dashboard.service');
const updateService = require('../services/update.service');

const SUMMARY_DEBOUNCE_MS = 800;
const STATS_INTERVAL_MS = 5000;

function compactMonitor(m) {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    target: m.target,
    status: m.status,
    active: m.active,
    groupId: m.groupId,
    groupName: m.groupName,
    latencyMs: m.lastLatencyMs,
    message: m.lastMessage,
    lastCheckAt: m.lastCheckAt,
    nextCheckAt: m.nextCheckAt,
    lastStatusChangeAt: m.lastStatusChangeAt,
    consecutiveFailures: m.consecutiveFailures,
    intervalSeconds: m.intervalSeconds,
  };
}

/**
 * Inicializa o Socket.IO com autenticação por sessão. Clientes recebem:
 *  - summary:    resumo consolidado (debounced)
 *  - monitor:update / monitor:check / monitor:status
 *  - event:new / incident:update / notification:update
 *  - system:stats  métricas do próprio processo
 */
function initSockets(httpServer, { engine }) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: true,
    cors: { origin: false },
    pingInterval: 20000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e5,
  });

  io.use((socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    const session = token ? sessionsRepo.findValid(sha256(token)) : null;
    if (!session || !session.active) return next(new Error('unauthorized'));
    socket.data.user = { id: session.user_id, username: session.username, role: session.role };
    return next();
  });

  let summaryTimer = null;
  const broadcastSummary = () => {
    if (summaryTimer) return;
    summaryTimer = setTimeout(() => {
      summaryTimer = null;
      io.emit('summary', dashboardService.summary());
    }, SUMMARY_DEBOUNCE_MS);
  };

  io.on('connection', (socket) => {
    socket.emit('hello', { version: config.version, serverTime: new Date().toISOString(), user: socket.data.user });
    socket.emit('summary', dashboardService.summary());
    socket.emit('system:stats', systemStats(engine));
    socket.emit('update:status', updateService.publicStatus());
  });
  bus.on('update:changed', (status) => io.emit('update:status', status));

  bus.on('monitor:changed', ({ monitor }) => {
    io.emit('monitor:update', compactMonitor(monitor));
    broadcastSummary();
  });
  bus.on('monitor:checked', ({ monitor, result, checkedAt }) => {
    io.emit('monitor:check', {
      id: monitor.id, ok: result.ok, latencyMs: result.latencyMs, message: result.message,
      status: monitor.status, checkedAt,
    });
  });
  bus.on('monitor:status', ({ monitor, previous, next, message, durationSeconds, checkedAt }) => {
    io.emit('monitor:status', {
      id: monitor.id, name: monitor.name, previous, next, message, durationSeconds, checkedAt,
    });
    io.emit('event:new', {
      monitorId: monitor.id, monitorName: monitor.name, previousStatus: previous,
      newStatus: next, message, durationSeconds, createdAt: checkedAt,
    });
  });
  for (const name of ['incident:opened', 'incident:updated', 'incident:resolved']) {
    bus.on(name, ({ incident }) => {
      io.emit('incident:update', { event: name, incident });
      broadcastSummary();
    });
  }
  bus.on('notification:sent', (payload) => io.emit('notification:update', payload));
  bus.on('monitor:paused', broadcastSummary);
  bus.on('monitor:resumed', broadcastSummary);

  const statsTimer = setInterval(() => {
    io.emit('system:stats', systemStats(engine));
    broadcastSummary();
  }, STATS_INTERVAL_MS);
  statsTimer.unref();

  io.close = ((original) => (...args) => {
    clearInterval(statsTimer);
    clearTimeout(summaryTimer);
    return original.apply(io, args);
  })(io.close.bind(io));

  return io;
}

function systemStats(engine) {
  const mem = process.memoryUsage();
  const load = os.loadavg();
  return {
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(mem.rss / 1048576),
    heapUsedMb: Math.round(mem.heapUsed / 1048576),
    loadAvg1: Math.round(load[0] * 100) / 100,
    cpuCount: os.cpus().length,
    engine: engine.snapshot(),
    at: new Date().toISOString(),
  };
}

module.exports = { initSockets, compactMonitor };
