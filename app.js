'use strict';

/**
 * Ponto de entrada do Noxis Uptime. Inicializa configuração, banco, motor de
 * monitoramento, notificações, Socket.IO e o servidor HTTP, e conecta os módulos.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');

const config = require('./src/config');
const { openDatabase, closeDatabase } = require('./src/db/connection');
const { runMigrations } = require('./src/db/migrations');
const bus = require('./src/events/bus');
const { MonitorEngine } = require('./src/monitors/engine');
const { createMonitorService } = require('./src/services/monitor.service');
const maintenanceService = require('./src/services/maintenance.service');
const { registerIncidentManager } = require('./src/incidents/manager');
const { NotificationManager, registerNotificationManager } = require('./src/notifications/notification.manager');
const { initSockets } = require('./src/sockets');
const { cookieParser } = require('./src/utils/cookies');
const { loadSession } = require('./src/middleware/auth');
const { notFound, errorHandler } = require('./src/middleware/error');
const { buildRouter } = require('./src/routes');
const formatHelpers = require('./src/utils/format');
const settingsRepo = require('./src/db/repositories/settings');
const sessionsRepo = require('./src/db/repositories/sessions');
const updateService = require('./src/services/update.service');

function createApp(services) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.srcDir, 'views'));
  app.locals.helpers = formatHelpers;
  app.locals.engine = services.engine;
  app.locals.config = config;
  app.locals.safeJson = (value) => JSON.stringify(value).replace(/</g, '\u003c');
  app.locals.roleLabel = (role) => ({ owner: 'Owner', admin: 'Administrador', editor: 'Editor', viewer: 'Visualizador' }[role] || role);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        // Desativa a diretiva padrão do Helmet: sem ela o navegador tenta
        // converter CSS/JS para HTTPS em acessos HTTP na rede local (ex.: 192.168.x.x).
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser);
  // Revalidação a cada carregamento (ETag): após uma atualização, o navegador
  // recebe o CSS e o JavaScript novos sem precisar de Ctrl+F5 nem esperar um cache de horas.
  app.use('/static', express.static(path.join(config.srcDir, 'public'), {
    index: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));
  app.use(loadSession);
  app.use((req, res, next) => {
    res.locals.section = '';
    res.locals.updateInfo = req.user ? updateService.publicStatus() : null;
    res.locals.pageScript = '';
    res.locals.appVersion = config.version;
    res.locals.timezone = settingsRepo.get('timezone', 'America/Bahia');
    next();
  });
  app.use(buildRouter(services));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** Remove sessões expiradas periodicamente (a cada hora). */
function startHousekeeping() {
  const timer = setInterval(() => {
    try {
      sessionsRepo.purgeExpired();
    } catch (err) {
      bus.emit('system:error', { scope: 'housekeeping', error: err });
    }
  }, 60 * 1000);
  timer.unref();
  return timer;
}

const maintenanceState = { announced: new Set(), closed: new Set() };

function wireModules() {
  const engine = new MonitorEngine({
    maxConcurrent: config.maxConcurrentChecks,
    isInMaintenance: (monitor) => maintenanceService.isMonitorInMaintenance(monitor),
  });
  const notificationManager = registerNotificationManager(new NotificationManager());
  registerIncidentManager();
  const monitorService = createMonitorService(engine);
  return { engine, notificationManager, monitorService };
}

async function main() {
  // node:sqlite ainda é marcado como experimental no Node 22; o aviso é suprimido apenas para ele.
  const originalEmit = process.emit;
  process.emit = function patchedEmit(name, data, ...rest) {
    if (name === 'warning' && data && /SQLite is an experimental feature/.test(data.message)) return false;
    return originalEmit.call(this, name, data, ...rest);
  };
  if (config.appSecretGenerated && config.env === 'production') {
    console.warn('[aviso] APP_SECRET não definido. Defina-o no arquivo .env para produção.');
  }
  const db = openDatabase(config.databasePath);
  runMigrations(db);

  const services = wireModules();
  const app = createApp(services);
  const server = http.createServer(app);
  const io = initSockets(server, { engine: services.engine });

  bus.on('system:error', ({ scope, error }) => {
    console.error(`[sistema:${scope}]`, error?.message || error);
  });

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  services.engine.start();
  startHousekeeping();
  updateService.startScheduler(services.notificationManager);

  console.log(`Noxis Uptime ${config.version} em http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Encerrando (${signal})...`);
    services.engine.stop();
    await services.engine.drain(10000);
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Tick de manutenções (início/fim) a cada 30s.
  const maintTimer = setInterval(() => maintenanceService.tick(maintenanceState), 30000);
  maintTimer.unref();

  return { app, server, services };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Falha ao iniciar o Noxis Uptime:', err);
    process.exit(1);
  });
}

module.exports = { createApp, main };
