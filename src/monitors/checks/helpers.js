'use strict';

/**
 * Interpreta expectedStatus: aceita "200", "200-299", "200,301" ou vazio (2xx).
 */
function getStatusMatcher(spec) {
  const raw = String(spec ?? '').trim();
  if (!raw) return (code) => code >= 200 && code < 300;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const ranges = parts.map((p) => {
    const m = /^(\d{3})(?:-(\d{3}))?$/.exec(p);
    if (!m) throw new Error(`Status esperado inválido: ${p}`);
    return [Number(m[1]), Number(m[2] || m[1])];
  });
  return (code) => ranges.some(([a, b]) => code >= a && code <= b);
}

/** Lê o corpo da resposta até um limite de bytes, sem carregar respostas gigantes. */
async function readLimited(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(Buffer.from(value));
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

/** Acessa caminho estilo "data.items.0.status" em objeto JSON. */
function jsonPathGet(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

module.exports = { getStatusMatcher, readLimited, jsonPathGet };
