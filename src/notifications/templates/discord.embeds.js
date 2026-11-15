'use strict';

/**
 * Monta payloads de embeds do Discord (campo `embeds` da API de webhooks).
 * Referência: https://discord.com/developers/docs/resources/webhook#execute-webhook
 */

const COLORS = {
  down: 0xed4245,        // vermelho
  up: 0x57f287,          // verde
  warning: 0xfee75c,     // amarelo
  maintenance: 0x5865f2, // azul
  degraded: 0xe67e22,    // laranja
  info: 0x95a5a6,        // cinza
};

const FOOTER = 'Noxis Uptime • Sistema de Monitoramento';
const MAX_FIELD = 1024;
const MAX_DESC = 4096;
const MAX_TITLE = 256;

const clip = (text, max) => {
  const s = String(text ?? '—');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function formatDate(date, timezone) {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone || 'America/Bahia',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts = [];
  if (days) parts.push(`${days} dia${days > 1 ? 's' : ''}`);
  if (hours) parts.push(`${hours} hora${hours > 1 ? 's' : ''}`);
  if (minutes) parts.push(`${minutes} minuto${minutes > 1 ? 's' : ''}`);
  if (seconds || !parts.length) parts.push(`${seconds} segundo${seconds !== 1 ? 's' : ''}`);
  return parts.join(' e ');
}

const field = (name, value, inline = true) => ({
  name: clip(name, 256),
  value: clip(value, MAX_FIELD),
  inline,
});

function monitorDown({ monitor, message, timezone, now = new Date(), attempts, latencyLabel }) {
  return {
    title: clip('🔴 Noxis Uptime — Serviço indisponível', MAX_TITLE),
    description: clip(`O monitor **${monitor.name}** apresentou uma falha e não está respondendo.`, MAX_DESC),
    color: COLORS.down,
    fields: [
      field('🖥️ Serviço', monitor.name),
      field('📡 Endereço', monitor.target),
      field('📊 Status', '🔴 DOWN'),
      field('⏱️ Latência', latencyLabel || 'Timeout'),
      field('📅 Detectado em', formatDate(now, timezone)),
      field('🔁 Tentativas', `${attempts.current} de ${attempts.max}`),
      field('🏷️ Grupo', monitor.groupName || 'Sem grupo'),
      field('🧾 Detalhe técnico', message || '—', false),
    ],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function monitorUp({ monitor, latencyMs, downtimeSeconds, timezone, now = new Date() }) {
  return {
    title: clip('🟢 Noxis Uptime — Serviço recuperado', MAX_TITLE),
    description: clip(`O monitor **${monitor.name}** voltou a responder normalmente.`, MAX_DESC),
    color: COLORS.up,
    fields: [
      field('🖥️ Serviço', monitor.name),
      field('📊 Status', '🟢 UP'),
      field('⚡ Latência atual', latencyMs != null ? `${latencyMs} ms` : '—'),
      field('⏳ Tempo indisponível', formatDuration(downtimeSeconds)),
      field('📅 Recuperado em', formatDate(now, timezone)),
    ],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function genericEmbed({ kind = 'info', title, description, fields = [], timezone, now = new Date() }) {
  return {
    title: clip(title, MAX_TITLE),
    description: clip(description, MAX_DESC),
    color: COLORS[kind] ?? COLORS.info,
    fields: fields.map((f) => field(f.name, f.value, f.inline !== false)),
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function sslExpiring({ monitor, daysLeft, timezone, now = new Date() }) {
  return {
    title: clip('🟡 Noxis Uptime — Certificado próximo do vencimento', MAX_TITLE),
    description: clip(`O certificado de **${monitor.name}** expira em **${daysLeft} dia(s)**.`, MAX_DESC),
    color: COLORS.warning,
    fields: [
      field('🖥️ Serviço', monitor.name),
      field('📡 Endereço', monitor.target),
      field('📆 Dias restantes', String(daysLeft)),
      field('📅 Verificado em', formatDate(now, timezone)),
    ],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function latencyHigh({ monitor, latencyMs, threshold, timezone, now = new Date() }) {
  return {
    title: clip('🟠 Noxis Uptime — Latência elevada', MAX_TITLE),
    description: clip(`O monitor **${monitor.name}** respondeu acima do limite configurado.`, MAX_DESC),
    color: COLORS.degraded,
    fields: [
      field('🖥️ Serviço', monitor.name),
      field('⚡ Latência', `${latencyMs} ms`),
      field('🎯 Limite', `${threshold} ms`),
      field('📅 Detectado em', formatDate(now, timezone)),
    ],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function incidentEmbed({ kind, incident, timezone, now = new Date() }) {
  const titles = {
    opened: ['🚨 Noxis Uptime — Incidente aberto', COLORS.down],
    updated: ['🔵 Noxis Uptime — Incidente atualizado', COLORS.maintenance],
    resolved: ['🟢 Noxis Uptime — Incidente resolvido', COLORS.up],
  };
  const [title, color] = titles[kind] || titles.updated;
  return {
    title: clip(title, MAX_TITLE),
    description: clip(`**${incident.title}**\n${incident.description || ''}`.trim(), MAX_DESC),
    color,
    fields: [
      field('🧭 Status', incident.status),
      field('⚠️ Severidade', incident.severity),
      field('🖥️ Monitor', incident.monitorName || '—'),
      field('📅 Data', formatDate(now, timezone)),
    ],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function maintenanceEmbed({ kind, maintenance, timezone, now = new Date() }) {
  const started = kind === 'started';
  return {
    title: clip(started ? '🛠️ Noxis Uptime — Manutenção iniciada' : '✅ Noxis Uptime — Manutenção finalizada', MAX_TITLE),
    description: clip(`**${maintenance.title}**\n${maintenance.description || ''}`.trim(), MAX_DESC),
    color: COLORS.maintenance,
    fields: [
      field('🕒 Início', formatDate(maintenance.startsAt, timezone)),
      field('🕓 Término', formatDate(maintenance.endsAt, timezone)),
      field('📅 Registro', formatDate(now, timezone)),
    ],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function rootCause({ root, affected = [], chains = [], timezone, now = new Date() }) {
  const affectedText = affected.length ? affected.map((n) => `• ${n}`).join('\n') : 'Nenhum';
  return {
    title: clip('🔴 Noxis Uptime — Possível causa raiz detectada', MAX_TITLE),
    description: clip(`O serviço **${root.name}** está indisponível.`, MAX_DESC),
    color: COLORS.down,
    fields: [
      field('🎯 Causa raiz', root.name),
      field('⚠️ Serviços potencialmente afetados', affectedText, false),
      field('🔗 Dependências', chains.length ? chains.join('\n') : '—', false),
      field('📅 Detectado em', formatDate(now, timezone)),
    ],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function heartbeatMissed({ monitor, intervalSeconds, timezone, now = new Date() }) {
  return {
    title: clip('🔴 Noxis Uptime — Heartbeat não recebido', MAX_TITLE),
    description: clip(`O sinal esperado de **${monitor.name}** não chegou no prazo.`, MAX_DESC),
    color: COLORS.down,
    fields: [
      field('🖥️ Serviço', monitor.name),
      field('⏲️ Intervalo esperado', `${intervalSeconds}s`),
      field('📅 Detectado em', formatDate(now, timezone)),
    ],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function pausedResumed({ kind, monitor, timezone, now = new Date() }) {
  const paused = kind === 'paused';
  return {
    title: clip(paused ? '⏸️ Noxis Uptime — Monitor pausado' : '▶️ Noxis Uptime — Monitor retomado', MAX_TITLE),
    description: clip(`O monitor **${monitor.name}** foi ${paused ? 'pausado' : 'retomado'}.`, MAX_DESC),
    color: COLORS.info,
    fields: [field('🖥️ Serviço', monitor.name), field('📅 Data', formatDate(now, timezone))],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

function testEmbed({ channelName, timezone, now = new Date() }) {
  return {
    title: clip('🧪 Noxis Uptime — Teste de notificação', MAX_TITLE),
    description: clip(`O canal **${channelName}** está configurado corretamente.`, MAX_DESC),
    color: COLORS.up,
    fields: [field('📅 Enviado em', formatDate(now, timezone))],
    footer: { text: FOOTER },
    timestamp: now.toISOString(),
  };
}

/** Constrói o payload final: menções opcionais em `content` e embeds. */
function buildPayload(embed, { mentionUserIds = [], mentionRoleIds = [], everyone = false } = {}) {
  const mentions = [
    ...mentionUserIds.map((id) => `<@${id}>`),
    ...mentionRoleIds.map((id) => `<@&${id}>`),
    ...(everyone ? ['@here'] : []),
  ];
  const payload = { embeds: [embed], allowed_mentions: { parse: [], users: mentionUserIds, roles: mentionRoleIds } };
  if (everyone) payload.allowed_mentions.parse = ['everyone'];
  if (mentions.length) payload.content = mentions.join(' ');
  return payload;
}

module.exports = {
  COLORS, FOOTER, formatDate, formatDuration, buildPayload,
  monitorDown, monitorUp, sslExpiring, latencyHigh, incidentEmbed, maintenanceEmbed,
  heartbeatMissed, rootCause, pausedResumed, testEmbed, genericEmbed,
};
