'use strict';

const { assertSafeHost } = require('../../utils/network');
const { getStatusMatcher, readLimited, jsonPathGet } = require('./helpers');

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Verificador HTTP/HTTPS com suporte a keyword e JSON query.
 * Cada salto de redirecionamento é validado contra a política de SSRF.
 */
async function runHttp(monitor, { signal, allowPrivate }) {
  const cfg = monitor.config || {};
  const method = String(cfg.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.includes(method)) throw new Error(`Método não suportado: ${method}`);

  let url;
  try {
    url = new URL(monitor.target);
  } catch (_) {
    throw new Error('URL inválida');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Apenas http e https são suportados');

  const headers = { 'user-agent': 'NoxisUptime/1.0 (+self-hosted monitor)', accept: '*/*' };
  for (const [k, v] of Object.entries(cfg.headers || {})) headers[String(k).toLowerCase()] = String(v);
  if (cfg.auth?.type === 'basic') {
    const token = Buffer.from(`${cfg.auth.username || ''}:${cfg.auth.password || ''}`).toString('base64');
    headers.authorization = `Basic ${token}`;
  } else if (cfg.auth?.type === 'bearer' && cfg.auth.token) {
    headers.authorization = `Bearer ${cfg.auth.token}`;
  } else if (cfg.auth?.type === 'apikey' && cfg.auth.name && cfg.auth.value) {
    // Chave de API no cabeçalho informado pelo usuário (ex.: X-Api-Key).
    headers[String(cfg.auth.name).toLowerCase()] = String(cfg.auth.value);
  }

  let body;
  if (cfg.body && method !== 'GET' && method !== 'HEAD') {
    body = String(cfg.body);
    if (!headers['content-type']) headers['content-type'] = 'application/json';
  }

  const followRedirects = cfg.followRedirects !== false;
  const started = Date.now();
  let currentMethod = method;
  let currentBody = body;
  let response;
  let hops = 0;

  for (;;) {
    await assertSafeHost(url.hostname, { allowPrivate });
    response = await fetch(url, {
      method: currentMethod,
      headers,
      body: currentBody,
      redirect: 'manual',
      signal,
    });
    const location = response.headers.get('location');
    if (followRedirects && response.status >= 300 && response.status < 400 && location) {
      if (++hops > MAX_REDIRECTS) throw new Error('Limite de redirecionamentos excedido');
      await response.body?.cancel().catch(() => {});
      url = new URL(location, url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Redirecionamento para protocolo inseguro');
      if ([301, 302, 303].includes(response.status) && currentMethod !== 'HEAD') {
        currentMethod = 'GET';
        currentBody = undefined;
      }
      continue;
    }
    break;
  }

  const latencyMs = Date.now() - started;
  const matchStatus = getStatusMatcher(cfg.expectedStatus);
  const reasons = [];
  let ok = matchStatus(response.status);
  if (!ok) reasons.push(`status ${response.status} fora do esperado (${cfg.expectedStatus || '2xx'})`);

  const needsBody = Boolean(cfg.keyword?.value) || Boolean(cfg.jsonPath) || Boolean(cfg.requiredKeys)
    || ['keyword', 'json', 'api'].includes(monitor.type);
  if (needsBody && method !== 'HEAD') {
    const text = await readLimited(response, MAX_BODY_BYTES);
    if (cfg.keyword?.value || monitor.type === 'keyword') {
      const keyword = String(cfg.keyword?.value ?? '');
      const caseSensitive = !!cfg.keyword?.caseSensitive;
      const haystack = caseSensitive ? text : text.toLowerCase();
      const needle = caseSensitive ? keyword : keyword.toLowerCase();
      const found = keyword.length > 0 && haystack.includes(needle);
      const mustExist = cfg.keyword?.mustExist !== false;
      if (found !== mustExist) {
        ok = false;
        reasons.push(mustExist ? 'palavra-chave não encontrada' : 'palavra-chave encontrada (era esperada ausência)');
      }
    }
    if (cfg.requiredKeys) {
      let obj;
      try { obj = JSON.parse(text); } catch (_) { obj = undefined; }
      const missing = String(cfg.requiredKeys).split(',').map((k) => k.trim()).filter(Boolean)
        .filter((k) => !(obj && typeof obj === 'object' && jsonPathGet(obj, k) !== undefined));
      if (obj === undefined) { ok = false; reasons.push('resposta não é JSON válido'); }
      else if (missing.length) { ok = false; reasons.push(`chaves ausentes: ${missing.join(', ')}`); }
    }
    if (cfg.jsonPath || monitor.type === 'json') {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        ok = false;
        reasons.push('resposta não é JSON válido');
      }
      if (parsed !== undefined) {
        const value = jsonPathGet(parsed, cfg.jsonPath || '');
        const expected = cfg.jsonExpected;
        const comparison = cfg.jsonOperator || 'equals';
        let pass;
        if (comparison === 'exists') pass = value !== undefined;
        else if (comparison === 'notEquals') pass = String(value) !== String(expected);
        else pass = String(value) === String(expected);
        if (!pass) {
          ok = false;
          reasons.push(`JSON ${cfg.jsonPath || '(raiz)'} = ${JSON.stringify(value) ?? 'undefined'}`);
        }
      }
    }
  } else {
    await response.body?.cancel().catch(() => {});
  }

  const message = ok
    ? `HTTP ${response.status} em ${latencyMs} ms`
    : `Falha: ${reasons.join('; ')}`;

  return {
    ok,
    latencyMs,
    message,
    details: { httpStatus: response.status, finalUrl: url.origin + url.pathname, redirects: hops },
  };
}

module.exports = { runHttp };
