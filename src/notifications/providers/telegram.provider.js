'use strict';

const { friendlyError } = require('../../utils/errors');

// Formato oficial do token de bot: <id>:<segredo>. O host é fixo (api.telegram.org),
// portanto não há risco de SSRF por configuração do usuário.
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{20,}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
const MAX_TEXT = 3900;

/** Texto simples (sem parse_mode, para não precisar escapar caracteres). */
function textFromPayload(payload) {
  const lines = [payload.title || 'Noxis Uptime'];
  if (payload.description) lines.push(payload.description);
  for (const f of payload.fields || []) lines.push(`${f.name}: ${f.value}`);
  const text = lines.join('\n');
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

async function sendTelegram(config, payload, { timeoutMs = 10000 } = {}) {
  if (!TOKEN_RE.test(config.botToken || '')) return { ok: false, permanent: true, error: 'Token do bot inválido' };
  if (!CHAT_RE.test(String(config.chatId || ''))) return { ok: false, permanent: true, error: 'ID do chat inválido' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'NoxisUptime/1.0' },
      body: JSON.stringify({ chat_id: String(config.chatId), text: textFromPayload(payload), disable_web_page_preview: true }),
      redirect: 'manual',
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) return { ok: true, status: res.status };
    if (res.status === 429) {
      const retry = Number(body.parameters?.retry_after || 1) * 1000;
      return { ok: false, status: 429, retryAfterMs: retry, error: 'Limite de envios do Telegram (429)' };
    }
    const permanent = res.status >= 400 && res.status < 500;
    return { ok: false, status: res.status, permanent, error: `Telegram: ${String(body.description || res.status).slice(0, 200)}` };
  } catch (err) {
    return { ok: false, status: 0, error: friendlyError(err) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendTelegram, textFromPayload, TOKEN_RE, CHAT_RE };
