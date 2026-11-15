'use strict';

const STATUS = {
  UP: { label: 'Online', cls: 'up', color: 'var(--c-up)' },
  DOWN: { label: 'Offline', cls: 'down', color: 'var(--c-down)' },
  PENDING: { label: 'Pendente', cls: 'pending', color: 'var(--c-pending)' },
  DEGRADED: { label: 'Degradado', cls: 'degraded', color: 'var(--c-degraded)' },
  MAINTENANCE: { label: 'Manutenção', cls: 'maintenance', color: 'var(--c-maintenance)' },
  PAUSED: { label: 'Pausado', cls: 'paused', color: 'var(--c-paused)' },
};

const formatterCache = new Map();

/** Formata data/hora no fuso configurado, em pt-BR. */
function formatDate(value, timezone = 'America/Bahia', withSeconds = true) {
  if (!value) return '—';
  const key = `${timezone}|${withSeconds}`;
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false,
    }));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : formatterCache.get(key).format(d);
}

/** Duração legível em pt-BR a partir de segundos. */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '—';
  const s = Math.max(0, Math.round(Number(seconds)));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}min`;
  if (m) return `${m}min ${sec}s`;
  return `${sec}s`;
}

function statusMeta(status) {
  return STATUS[status] || { label: status || '—', cls: 'unknown', color: 'var(--c-muted)' };
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}%`;
}

function formatLatency(ms) {
  return ms === null || ms === undefined ? '—' : `${ms} ms`;
}

module.exports = { STATUS, formatDate, formatDuration, statusMeta, formatPercent, formatLatency };
