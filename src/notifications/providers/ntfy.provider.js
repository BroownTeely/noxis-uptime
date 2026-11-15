'use strict';

const { assertSafeHost } = require('../../utils/network');
const { friendlyError } = require('../../utils/errors');

const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Monta a URL de publicação do ntfy: <servidor>/<tópico>. */
function publishUrl(config) {
  const base = new URL(config.serverUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('URL do servidor ntfy inválida');
  }
  if (!TOPIC_RE.test(config.topic || '')) throw new Error('Tópico ntfy inválido');
  const path = base.pathname.replace(/\/+$/, '');
  return new URL(`${path}/${config.topic}`, base.origin);
}

// Cabeçalhos HTTP aceitam apenas ASCII: o título com emoji vai no corpo.
const asciiTitle = (t) => (String(t || '').replace(/[^\x20-\x7E]/g, '').trim() || 'Noxis Uptime');

/**
 * Envia para um servidor ntfy (self-hosted ou público). Redirecionamentos não são
 * seguidos, e o destino passa pela mesma política de rede dos monitores.
 */
async function sendNtfy(config, payload, { allowPrivate = true, timeoutMs = 10000 } = {}) {
  let url;
  try {
    url = publishUrl(config);
  } catch (err) {
    return { ok: false, permanent: true, error: err.message };
  }
  try {
    await assertSafeHost(url.hostname, { allowPrivate });
  } catch (err) {
    return { ok: false, permanent: true, error: friendlyError(err) };
  }

  const lines = [payload.description || ''];
  for (const f of payload.fields || []) lines.push(`${f.name}: ${f.value}`);
  const headers = {
    Title: asciiTitle(payload.title),
    Priority: String(Number(config.priority) || (payload.event && /down|root|ssl/.test(payload.event) ? 5 : 3)),
    Tags: payload.event && /down|root|ssl/.test(payload.event) ? 'rotating_light' : 'white_check_mark',
    'User-Agent': 'NoxisUptime/1.0',
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST', headers, body: lines.filter(Boolean).join('\n'),
      redirect: 'manual', signal: controller.signal,
    });
    await res.body?.cancel().catch(() => {});
    if (res.ok) return { ok: true, status: res.status };
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    return { ok: false, status: res.status, permanent, error: `ntfy HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, error: friendlyError(err) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendNtfy, publishUrl };
