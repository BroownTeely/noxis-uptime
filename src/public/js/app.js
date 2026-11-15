/**
 * Ponto de entrada do painel. Inicializa tema, sidebar e conexão em tempo real,
 * depois carrega o módulo da página atual.
 */
import { readAppData } from './core/dom.js';
import { initTheme } from './core/theme.js';
import { initSidebar } from './core/sidebar.js';
import { connect, on } from './core/socket.js';
import { initLiveSummary } from './core/live.js';
import { initModalTriggers } from './core/modal.js';

const app = readAppData();
const pageModules = {
  dashboard: () => import('./pages/dashboard.js'),
  monitors: () => import('./pages/monitors.js'),
  'monitor-form': () => import('./pages/monitor-form.js'),
  'monitor-detail': () => import('./pages/monitor-detail.js'),
  groups: () => import('./pages/groups.js'),
  'incident-detail': () => import('./pages/incident-detail.js'),
  maintenance: () => import('./pages/maintenance.js'),
  webhooks: () => import('./pages/webhooks.js'),
  reports: () => import('./pages/reports.js'),
  logs: () => import('./pages/logs.js'),
  users: () => import('./pages/users.js'),
  settings: () => import('./pages/settings.js'),
  profile: () => import('./pages/profile.js'),
  'status-pages': () => import('./pages/status-pages.js'),
  discovery: () => import('./pages/discovery.js'),
  updates: () => import('./pages/update.js'),
  'status-page-form': () => import('./pages/status-page-form.js'),
};

initTheme();
initSidebar();
initModalTriggers();

if (app.user) {
  const socket = connect();
  initLiveSummary();
  if (socket) {
    // Disponibiliza o cliente para módulos de página, sem variáveis globais soltas.
    window.noxis = { socket, user: app.user, timezone: app.timezone, csrf: app.csrf };
  }
}

const loader = pageModules[app.page];
if (loader) {
  loader()
    .then((mod) => mod.init?.({ user: app.user, timezone: app.timezone }))
    .catch((err) => console.error('Falha ao carregar página', err));
}
