import { readAppData } from './dom.js';

const appData = readAppData();
export const timezone = appData.timezone || 'America/Bahia';

const fmtFull = new Intl.DateTimeFormat('pt-BR', {
  timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const fmtShort = new Intl.DateTimeFormat('pt-BR', {
  timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

export function formatDateTime(value, short = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return (short ? fmtShort : fmtFull).format(d);
}

export function formatDuration(seconds) {
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

export const STATUS = {
  UP: { label: 'Online', cls: 'up' },
  DOWN: { label: 'Offline', cls: 'down' },
  PENDING: { label: 'Pendente', cls: 'pending' },
  DEGRADED: { label: 'Degradado', cls: 'degraded' },
  MAINTENANCE: { label: 'Manutenção', cls: 'maintenance' },
  PAUSED: { label: 'Pausado', cls: 'paused' },
};

export const statusMeta = (s) => STATUS[s] || { label: s || '—', cls: 'unknown' };

export const pct = (v, digits = 2) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(digits)}%`);
export const ms = (v) => (v === null || v === undefined ? '—' : `${v} ms`);
