'use strict';

const config = require('../config');
const settingsRepo = require('../db/repositories/settings');
const monitorsRepo = require('../db/repositories/monitors');
const incidentsRepo = require('../db/repositories/incidents');
const { groupsRepo, channelsRepo } = require('../db/repositories/notifications');
const maintenanceService = require('../services/maintenance.service');
const { dashboardService } = require('../services/dashboard.service');
const { TYPES } = require('../monitors/checks');
const usersRepo = require('../db/repositories/users');
const apiKeysRepo = require('../db/repositories/apikeys');
const { EVENT_CATALOG } = require('../notifications/notification.manager');
const { asyncHandler, toId, HttpError, clampInt } = require('../utils/http');
const { maskConfig } = require('../validators/monitor.validator');
const { presentChannel } = require('../services/notification.service');
const { buildDetail } = require('../services/monitor.service');
const dependencyService = require('../services/dependency.service');
const statusPageService = require('../services/statuspage.service');

/** Renderiza página com dados comuns (usuário, configurações, seção ativa). */
function page(view, title, section) {
  return (req, res) => {
    res.render(view, {
      title, section, settings: settingsRepo.all(), version: config.version,
      productName: config.appName, timezone: settingsRepo.get('timezone', 'America/Bahia'),
      ...(res.locals.extra || {}),
    });
  };
}

function requireRoleLocal(role) {
  return (req, res, next) => {
    const rank = usersRepo.ROLE_RANK;
    if ((rank[req.user?.role] || 0) >= rank[role]) return next();
    return res.status(403).render('errors/403', { title: 'Acesso negado', section: '', settings: settingsRepo.all(), version: config.version, productName: config.appName, timezone: 'America/Bahia' });
  };
}

module.exports = {
  dashboard: asyncHandler(async (req, res) => {
    res.render('pages/dashboard', baseData('Dashboard', 'dashboard', {
      summary: dashboardService.summary(),
      rankings: dashboardService.rankings(),
      groups: dashboardService.groupSummary(),
      activity: dashboardService.activity(12),
      incidents: dashboardService.latestIncidents(5),
    }));
  }),

  monitors: asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const groupId = toId(req.query.groupId);
    const list = monitorsRepo.list({ status, groupId }).map((m) => ({ ...m, config: maskConfig(m.config) }));
    res.render('pages/monitors', baseData('Todos os monitores', 'monitors', {
      monitors: list, groups: groupsRepo.list(), types: TYPES, filters: { status, groupId },
    }));
  }),

  monitorNew: (req, res) => res.render('pages/monitor-form', baseData('Novo monitor', 'monitors', {
    monitor: null, groups: groupsRepo.list(), types: TYPES,
  })),

  monitorEdit: asyncHandler(async (req, res) => {
    const m = monitorsRepo.findById(toId(req.params.id));
    if (!m) return res.status(404).render('errors/404', baseData('Não encontrado', 'monitors', {}));
    res.render('pages/monitor-form', baseData('Editar monitor', 'monitors', {
      monitor: { ...m, config: maskConfig(m.config) }, groups: groupsRepo.list(), types: TYPES,
    }));
  }),

  monitorDetail: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const detail = id && buildDetail(id);
    if (!detail) return res.status(404).render('errors/404', baseData('Não encontrado', 'monitors', {}));
    res.render('pages/monitor-detail', baseData(detail.monitor.name, 'monitors', {
      monitorId: id, types: TYPES, ...detail,
      dependencies: dependencyService.details(id),
      allMonitors: monitorsRepo.list().filter((m) => m.id !== id).map((m) => ({ id: m.id, name: m.name })),
      monitor: { ...detail.monitor, config: maskConfig(detail.monitor.config) },
      baseUrl: '',
    }));
  }),

  groups: asyncHandler(async (req, res) => {
    res.render('pages/groups', baseData('Grupos', 'groups', {
      groups: dashboardService.groupSummary(), rawGroups: groupsRepo.list(),
    }));
  }),

  incidents: asyncHandler(async (req, res) => {
    const state = req.query.state === 'resolved' ? false : req.query.state === 'open' ? true : null;
    res.render('pages/incidents', baseData('Incidentes', 'incidents', {
      incidents: incidentsRepo.list({ open: state, limit: 100 }).rows, state,
    }));
  }),

  incidentDetail: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const incident = id && incidentsRepo.findById(id);
    if (!incident) return res.status(404).render('errors/404', baseData('Não encontrado', 'incidents', {}));
    res.render('pages/incident-detail', baseData(`Incidente #${id}`, 'incidents', {
      incident, updates: incidentsRepo.updates(id),
    }));
  }),

  maintenance: asyncHandler(async (req, res) => {
    res.render('pages/maintenance', baseData('Manutenções programadas', 'maintenance', {
      windows: maintenanceService.list(), monitors: monitorsRepo.list(), groups: groupsRepo.list(),
    }));
  }),

  notifications: asyncHandler(async (req, res) => {
    res.render('pages/webhooks', baseData('Webhooks e notificações', 'notifications', {
      channels: channelsRepo.list().map(presentChannel),
      events: EVENT_CATALOG, monitors: monitorsRepo.list(), groups: groupsRepo.list(),
    }));
  }),

  reports: asyncHandler(async (req, res) => {
    res.render('pages/reports', baseData('Relatórios', 'reports', { groups: groupsRepo.list() }));
  }),

  logs: asyncHandler(async (req, res) => {
    res.render('pages/logs', baseData('Logs e auditoria', 'logs', {}));
  }),

  users: [requireRoleLocal('admin'), asyncHandler(async (req, res) => {
    res.render('pages/users', baseData('Usuários e permissões', 'users', {
      users: usersRepo.list(), roles: usersRepo.ROLES,
    }));
  })],

  settings: [requireRoleLocal('admin'), asyncHandler(async (req, res) => {
    res.render('pages/settings', baseData('Configurações', 'settings', {
      keys: apiKeysRepo.list(), scopes: apiKeysRepo.SCOPES, values: settingsRepo.all(),
      backups: require('../services/backup.service').list(),
    }));
  })],

  profile: (req, res) => res.render('pages/profile', baseData('Perfil', 'profile', {})),

  /** Formulários servidos para o modal. A permissão é verificada por formulário. */
  fragment: asyncHandler(async (req, res) => {
    const name = String(req.params.name);
    const needed = { 'monitor-form': 'editor', 'status-page-form': 'admin', 'group-form': 'editor', 'maintenance-form': 'editor' }[name];
    if (!needed) return res.status(404).type('text/plain').send('Formulário não encontrado');
    if ((usersRepo.ROLE_RANK[req.user?.role] || 0) < usersRepo.ROLE_RANK[needed]) {
      return res.status(403).type('text/plain').send('Permissão insuficiente');
    }
    const id = toId(req.query.id);
    if (name === 'monitor-form') {
      const m = id ? monitorsRepo.findById(id) : null;
      if (id && !m) return res.status(404).type('text/plain').send('Monitor não encontrado');
      return res.render('fragments/monitor-form', {
        monitor: m ? { ...m, config: maskConfig(m.config) } : null, groups: groupsRepo.list(), types: TYPES,
      });
    }
    if (name === 'status-page-form') {
      const page = id ? statusPageService.findById(id) : null;
      if (id && !page) return res.status(404).type('text/plain').send('Página não encontrada');
      return res.render('fragments/status-page-form', {
        page, rows: statusPageRows(page ? page.id : null),
        privateToken: page && !page.isPublic ? statusPageService.privateToken(page.id) : null,
      });
    }
    if (name === 'group-form') {
      const group = id ? groupsRepo.findById(id) : null;
      if (id && !group) return res.status(404).type('text/plain').send('Grupo não encontrado');
      return res.render('fragments/group-form', { group });
    }
    return res.render('fragments/maintenance-form', { monitors: monitorsRepo.list(), groups: groupsRepo.list() });
  }),

  about: (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const { render: md } = require('../utils/markdown');
    const readme = fs.existsSync(path.join(config.root, 'README.md'))
      ? fs.readFileSync(path.join(config.root, 'README.md'), 'utf8') : '# Noxis Uptime';
    res.render('pages/about', baseData('Sobre o Noxis Uptime', 'about', {
      readmeHtml: md(readme), repo: require('../services/update.service').REPO,
    }));
  },

  updates: (req, res) => {
    res.render('pages/update', baseData('Atualização', 'updates', {
      status: require('../services/update.service').publicStatus(),
    }));
  },

  map: (req, res) => {
    const mapService = require('../services/map.service');
    const dependencyService = require('../services/dependency.service');
    res.render('pages/map', baseData('Mapa da infraestrutura', 'map', {
      map: mapService.build(dependencyService.graph()),
    }));
  },

  discovery: (req, res) => res.render('pages/discovery', baseData('Descoberta de portas', 'discovery', {
    commonPorts: require('../services/discovery.service').COMMON_PORTS.map((p) => ({ port: p, service: require('../services/discovery.service').serviceName(p) })),
    maxPorts: require('../services/discovery.service').MAX_PORTS,
  })),

  statusPages: (req, res) => res.render('pages/status-pages', baseData('Status pages', 'status-pages', {
    pages: statusPageService.list(),
  })),

  statusPageNew: (req, res) => res.render('pages/status-page-form', baseData('Nova status page', 'status-pages', {
    page: null, rows: statusPageRows(null),
  })),

  statusPageEdit: asyncHandler(async (req, res) => {
    const page = statusPageService.findById(toId(req.params.id));
    if (!page) return res.status(404).type('text/plain').send('Página não encontrada');
    res.render('pages/status-page-form', baseData('Editar status page', 'status-pages', {
      page, rows: statusPageRows(page.id),
      privateToken: require('../services/statuspage.service').privateToken(page.id),
    }));
  }),
};

/** Linhas do editor: monitores selecionados primeiro (na ordem salva), depois os demais. */
function statusPageRows(pageId) {
  const spRepo = require('../db/repositories/statuspages');
  const items = pageId ? spRepo.items(pageId) : [];
  const all = monitorsRepo.list();
  const byId = new Map(all.map((m) => [m.id, m]));
  const rows = [];
  for (const it of items) {
    const m = byId.get(it.monitorId);
    if (m) rows.push({ id: m.id, name: m.name, groupLabel: it.groupLabel, selected: true });
  }
  for (const m of all) {
    if (!items.some((i) => i.monitorId === m.id)) rows.push({ id: m.id, name: m.name, groupLabel: 'Serviços', selected: false });
  }
  return rows;
}

function baseData(title, section, extra) {
  return {
    title, section, extra,
    settings: settingsRepo.all(),
    version: config.version,
    productName: config.appName,
    timezone: settingsRepo.get('timezone', 'America/Bahia'),
    ...extra,
  };
}

module.exports.baseData = baseData;
module.exports.page = page;
