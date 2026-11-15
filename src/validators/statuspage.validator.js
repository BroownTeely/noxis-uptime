'use strict';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const THEMES = ['dark', 'light', 'auto'];

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v, fallback) => (v === undefined ? fallback : v === true || v === 'true' || v === 'on');

/** URLs de logo/favicon: apenas http(s). Vazio é permitido. */
function safeUrl(v) {
  const s = str(v, 500);
  if (!s) return { value: '', ok: true };
  try {
    const u = new URL(s);
    return { value: u.toString(), ok: ['http:', 'https:'].includes(u.protocol) };
  } catch (_) {
    return { value: '', ok: false };
  }
}

/**
 * Valida a configuração de uma status page. `items` é a lista ordenada de
 * { monitorId, groupLabel }. A existência dos monitores é verificada pelo serviço.
 */
function validateStatusPage(body = {}) {
  const errors = [];
  const name = str(body.name, 80);
  if (name.length < 2) errors.push('Informe um nome com pelo menos 2 caracteres.');
  const slug = str(body.slug, 60).toLowerCase();
  if (!SLUG_RE.test(slug)) errors.push('Slug inválido: use letras minúsculas, números e hífens (2 a 60 caracteres).');
  const title = str(body.title, 120) || name;
  const theme = THEMES.includes(body.theme) ? body.theme : 'dark';
  const accentColor = HEX_RE.test(body.accentColor || '') ? body.accentColor : '#22d3ee';
  const logo = safeUrl(body.logoUrl);
  const favicon = safeUrl(body.faviconUrl);
  if (!logo.ok) errors.push('URL do logo inválida (use http ou https).');
  if (!favicon.ok) errors.push('URL do favicon inválida (use http ou https).');
  let customDomain = str(body.customDomain, 253).toLowerCase() || null;
  if (customDomain && !DOMAIN_RE.test(customDomain)) errors.push('Domínio personalizado inválido.');

  const seen = new Set();
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200).reduce((acc, it) => {
    const monitorId = Number(it && it.monitorId);
    if (!Number.isInteger(monitorId) || monitorId < 1 || seen.has(monitorId)) return acc;
    seen.add(monitorId);
    acc.push({ monitorId, groupLabel: str(it.groupLabel, 60) || 'Serviços' });
    return acc;
  }, []);

  return {
    errors,
    value: {
      name, slug, title, items,
      description: str(body.description, 300),
      isPublic: bool(body.isPublic, true),
      theme, accentColor,
      logoUrl: logo.value, faviconUrl: favicon.value, customDomain,
      showLatency: bool(body.showLatency, true),
      showUptime: bool(body.showUptime, true),
      showHistory: bool(body.showHistory, true),
      showIncidents: bool(body.showIncidents, true),
      showMaintenance: bool(body.showMaintenance, true),
      showDependencies: bool(body.showDependencies, false),
      showFooter: bool(body.showFooter, true),
    },
  };
}

module.exports = { validateStatusPage, THEMES };
