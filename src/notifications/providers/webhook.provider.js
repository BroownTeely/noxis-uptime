'use strict';

const crypto = require('crypto');
const { assertSafeHost } = require('../../utils/network');
const { friendlyError } = require('../../utils/errors');

/**
 * Webhook HTTP genérico em JSON. Quando há segredo configurado, o corpo é assinado
 * com HMAC-SHA256 no cabeçalho X-Noxis-Signature (sha256=<hex>), para que o
 * receptor valide a origem da mensagem.
 */
async function sendWebhook(config, payload, { allowPrivate = true, timeoutMs = 10000, event = '' } = {}) {
  let url;
  try {
    url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL inválida');
  } catch (_) {
    return { ok: false, permanent: true, error: 'URL do webhook inválida' };
  }
  try {
    await assertSafeHost(url.hostname, { allowPrivate });
  } catch (err) {
    return { ok: false, permanent: true, error: friendlyError(err) };
  }

  const body = JSON.stringify({ source: 'noxis-uptime', ...payload, sentAt: new Date().toISOString() });
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'NoxisUptime-Webhook/1.0',
    'x-noxis-event': event,
  };
  if (config.secret) {
    headers['x-noxis-signature'] = `sha256=${crypto.createHmac('sha256', config.secret).update(body).digest('hex')}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: controller.signal });
    await res.body?.cancel().catch(() => {});
    if (res.ok) return { ok: true, status: res.status };
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    return { ok: false, status: res.status, permanent, error: `Webhook HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, error: friendlyError(err) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendWebhook };
