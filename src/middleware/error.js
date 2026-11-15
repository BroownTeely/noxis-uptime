'use strict';

const config = require('../config');
const bus = require('../events/bus');

function notFound(req, res) {
  if (req.originalUrl.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada' });
  return res.status(404).render('errors/404', {
    title: 'Página não encontrada', section: '', productName: config.appName, version: config.version,
    settings: {}, timezone: 'America/Bahia', user: res.locals.user, csrfToken: res.locals.csrfToken,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    bus.emit('system:error', { scope: 'http', error: err, path: req.path });
    console.error(`[erro] ${req.method} ${req.path}:`, err);
  }
  const message = status >= 500 ? 'Erro interno do servidor' : err.message;
  if (req.originalUrl.startsWith('/api/') || req.get('accept')?.includes('application/json')) {
    return res.status(status).json({ error: message });
  }
  return res.status(status).render('errors/500', {
    title: 'Erro', section: '', productName: config.appName, version: config.version,
    settings: {}, timezone: 'America/Bahia', message, user: res.locals.user, csrfToken: res.locals.csrfToken,
  });
}

module.exports = { notFound, errorHandler };
