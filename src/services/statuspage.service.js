'use strict';

const spRepo = require('../db/repositories/statuspages');
const monitorsRepo = require('../db/repositories/monitors');
const { checksRepo } = require('../db/repositories/checks');
const incidentsRepo = require('../db/repositories/incidents');
const audit = require('../db/repositories/audit');
const maintenanceService = require('./maintenance.service');
const dependencyService = require('./dependency.service');
const { heartbeatBars } = require('./monitor.service');
const { validateStatusPage } = require('../validators/statuspage.validator');
const { generateToken, safeEqual } = require('../auth/security');

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);
const LABEL = { UP: 'Online', DOWN: 'Offline', PENDING: 'Pendente', DEGRADED: 'Degradado', MAINTENANCE: 'Manutenção', PAUSED: 'Pausado' };

/** Resolve o estado exibido: estado derivado de dependências tem precedência sobre UP. */
function displayState(stored, derived) {
  if (stored === 'DOWN' || stored === 'PAUSED' || stored === 'MAINTENANCE') return stored;
  if (derived === 'DEGRADED') return 'DEGRADED';
  return stored;
}

function validateItems(items) {
  const missing = items.filter((it) => !monitorsRepo.findById(it.monitorId));
  return missing.length ? `Monitor(es) inexistente(s): ${missing.map((m) => m.monitorId).join(', ')}` : null;
}

const statusPageService = {
  list: () => spRepo.list(),
  findById: (id) => spRepo.findById(id),
  monitorChoices: () => monitorsRepo.list().map((m) => ({ id: m.id, name: m.name, groupName: m.groupName })),

  create(body, user, ip) {
    const { value, errors } = validateStatusPage(body);
    if (errors.length) return { errors };
    if (spRepo.findBySlug(value.slug)) return { errors: ['Já existe uma página com este slug.'] };
    if (value.customDomain && spRepo.findByDomain(value.customDomain)) return { errors: ['Domínio já associado a outra página.'] };
    const itemError = validateItems(value.items);
    if (itemError) return { errors: [itemError] };
    const id = spRepo.save(null, value, user.id);
    if (!value.isPublic) spRepo.setToken(id, generateToken(24).token);
    audit.write({ userId: user.id, username: user.username, action: 'statuspage.created', entity: 'status_page', entityId: id,
      details: { slug: value.slug }, ip });
    return { page: spRepo.findById(id) };
  },

  update(id, body, user, ip) {
    const current = spRepo.findById(id);
    if (!current) return { notFound: true };
    const { value, errors } = validateStatusPage(body);
    if (errors.length) return { errors };
    const bySlug = spRepo.findBySlug(value.slug);
    if (bySlug && bySlug.id !== id) return { errors: ['Já existe uma página com este slug.'] };
    if (value.customDomain) {
      const byDomain = spRepo.findByDomain(value.customDomain);
      if (byDomain && byDomain.id !== id) return { errors: ['Domínio já associado a outra página.'] };
    }
    const itemError = validateItems(value.items);
    if (itemError) return { errors: [itemError] };
    spRepo.save(id, value, user.id);
    if (!value.isPublic && !spRepo.tokenOf(id)) spRepo.setToken(id, generateToken(24).token);
    audit.write({ userId: user.id, username: user.username, action: 'statuspage.updated', entity: 'status_page', entityId: id, ip });
    return { page: spRepo.findById(id) };
  },

  /** Token privado: acesso à página privada sem login (ex.: /status/slug?token=...). */
  privateToken: (id) => spRepo.tokenOf(id),

  checkToken(page, given) {
    const stored = spRepo.tokenOf(page.id);
    return !!stored && !!given && safeEqual(given, stored);
  },

  regenerateToken(id, user, ip) {
    const page = spRepo.findById(id);
    if (!page) return null;
    const token = generateToken(24).token;
    spRepo.setToken(id, token);
    audit.write({ userId: user.id, username: user.username, action: 'statuspage.token_regenerated', severity: 'notice',
      entity: 'status_page', entityId: id, ip });
    return token;
  },

  remove(id, user, ip) {
    const current = spRepo.findById(id);
    if (!current) return false;
    spRepo.remove(id);
    audit.write({ userId: user.id, username: user.username, action: 'statuspage.deleted', severity: 'notice',
      entity: 'status_page', entityId: id, details: { slug: current.slug }, ip });
    return true;
  },

  /**
   * Monta a visão pública. Expõe somente os monitores selecionados, sem alvos
   * (endereços), configurações, mensagens técnicas ou credenciais.
   */
  buildView(page) {
    const items = spRepo.items(page.id);
    const ids = items.map((i) => i.monitorId);
    const selected = new Set(ids);
    const states = dependencyService.statesOf(ids);

    const monitors = items.map((item) => {
      const m = monitorsRepo.findById(item.monitorId);
      if (!m) return null;
      const stored = m.status;
      const state = displayState(stored, states.get(m.id));
      const deps = page.showDependencies
        ? dependencyService.details(m.id).dependsOn.filter((d) => selected.has(d.id)).map((d) => d.name)
        : [];
      const impact = state === 'DOWN'
        ? dependencyService.affectedBy(m.id).filter((id) => selected.has(id)).length
        : 0;
      return {
        id: m.id,
        name: m.name,
        groupLabel: item.groupLabel,
        state,
        label: LABEL[state] || state,
        cls: String(state || 'unknown').toLowerCase(),
        uptime24h: page.showUptime ? checksRepo.availability(m.id, hoursAgo(24)).uptimePercent : null,
        uptime7d: page.showUptime ? checksRepo.availability(m.id, daysAgo(7)).uptimePercent : null,
        uptime30d: page.showUptime ? checksRepo.availability(m.id, daysAgo(30)).uptimePercent : null,
        latencyMs: page.showLatency ? m.lastLatencyMs : null,
        lastCheckAt: m.lastCheckAt,
        bars: page.showHistory ? heartbeatBars(m.id, 90) : null,
        dependsOn: deps,
        impact,
      };
    }).filter(Boolean);

    const groups = [];
    for (const m of monitors) {
      let g = groups.find((x) => x.label === m.groupLabel);
      if (!g) groups.push((g = { label: m.groupLabel, monitors: [] }));
      g.monitors.push(m);
    }

    const stateList = monitors.map((m) => m.state);
    let overall;
    if (!monitors.length) overall = { level: 'unknown', text: 'Nenhum serviço selecionado' };
    else if (stateList.every((s) => s === 'UP')) overall = { level: 'up', text: 'Todos os sistemas operacionais' };
    else if (stateList.every((s) => s === 'DOWN')) overall = { level: 'down', text: 'Sistemas indisponíveis' };
    else if (stateList.some((s) => s === 'DOWN')) overall = { level: 'down', text: 'Alguns serviços estão apresentando problemas' };
    else overall = { level: 'degraded', text: 'Alguns serviços estão degradados' };

    const openIncidents = page.showIncidents
      ? incidentsRepo.list({ open: true, limit: 100 }).rows
          .filter((i) => i.monitorId && selected.has(i.monitorId))
          .map((i) => ({ id: i.id, title: i.title, status: i.status, startedAt: i.startedAt,
            updates: incidentsRepo.updates(i.id).map((u) => ({ status: u.status, message: u.message, createdAt: u.createdAt })) }))
      : [];
    const history = page.showIncidents
      ? incidentsRepo.list({ open: false, limit: 60 }).rows
          .filter((i) => i.monitorId && selected.has(i.monitorId))
          .slice(0, 10)
          .map((i) => ({ id: i.id, title: i.title, startedAt: i.startedAt, resolvedAt: i.resolvedAt }))
      : [];
    const maintenance = page.showMaintenance
      ? maintenanceService.list()
          .filter((w) => w.status !== 'finished' && (w.monitorIds.some((id) => selected.has(id))))
          .map((w) => ({ id: w.id, title: w.title, description: w.description, startsAt: w.startsAt, endsAt: w.endsAt, status: w.status }))
      : [];

    return { page, overall, groups, openIncidents, history, maintenance, generatedAt: new Date().toISOString() };
  },
};

module.exports = statusPageService;
