'use strict';

const { friendlyError } = require('../../utils/errors');

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

function isValidDiscordWebhook(url) {
  return typeof url === 'string' && DISCORD_WEBHOOK_RE.test(url.trim());
}

/**
 * Envia um payload ao webhook. Retorna { ok, status, retryAfterMs, error }.
 * Trata HTTP 429 respeitando retry_after e erros 5xx como transitórios.
 */
async function sendDiscord(webhookUrl, payload, { timeoutMs = 10000 } = {}) {
  if (!isValidDiscordWebhook(webhookUrl)) {
    return { ok: false, status: 0, permanent: true, error: 'URL de webhook do Discord inválida' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${webhookUrl.trim()}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.status === 429) {
      let retryMs = Number(res.headers.get('retry-after') || 0) * 1000;
      try {
        const body = await res.json();
        if (body.retry_after) retryMs = Math.ceil(Number(body.retry_after) * 1000);
      } catch (_) { /* corpo opcional */ }
      return { ok: false, status: 429, retryAfterMs: Math.max(retryMs, 1000), error: 'Limite de taxa do Discord (429)' };
    }
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => '');
    const permanent = res.status >= 400 && res.status < 500;
    return { ok: false, status: res.status, permanent, error: `Discord HTTP ${res.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, status: 0, error: friendlyError(err) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendDiscord, isValidDiscordWebhook };
