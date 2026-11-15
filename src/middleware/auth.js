'use strict';

const config = require('../config');
const sessionsRepo = require('../db/repositories/sessions');
const { sha256, safeEqual } = require('../auth/security');
const usersRepo = require('../db/repositories/users');

const SESSION_COOKIE = 'noxis_sid';

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: maxAgeMs,
  };
}

/** Lê a sessão do cookie e expõe req.user / res.locals.user. */
function loadSession(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  res.locals.user = null;
  res.locals.csrfToken = '';
  if (!token) return next();
  const session = sessionsRepo.findValid(sha256(token));
  if (!session || !session.active) return next();
  req.user = {
    id: session.user_id,
    username: session.username,
    displayName: session.display_name,
    role: session.role,
  };
  req.session = { id: session.id, csrfToken: session.csrf_token };
  res.locals.user = req.user;
  res.locals.csrfToken = session.csrf_token;
  return next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  if (usersRepo.count() === 0) return res.redirect('/setup');
  const back = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${back}`);
}

/** Exige papel mínimo (viewer < editor < admin < owner). Aplicado no backend. */
function requireRole(minRole) {
  const needed = usersRepo.ROLE_RANK[minRole];
  return (req, res, next) => {
    const have = usersRepo.ROLE_RANK[req.user?.role] || 0;
    if (have >= needed) return next();
    if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'Permissão insuficiente' });
    return res.status(403).render('errors/403', { title: 'Acesso negado' });
  };
}

/**
 * Proteção CSRF para requisições que alteram estado. Aceita o token no campo
 * _csrf de formulários ou no cabeçalho X-CSRF-Token (fetch/Socket.IO).
 */
function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.originalUrl.startsWith('/api/v1/') || req.originalUrl.startsWith('/api/push/')) return next(); // autenticação por API key / token próprio
  const provided = req.get('x-csrf-token') || req.body?._csrf;
  const expected = req.session?.csrfToken || res.locals.csrfToken;
  if (expected && provided && safeEqual(provided, expected)) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'Token CSRF inválido' });
  return res.status(403).render('errors/403', { title: 'Sessão expirada' });
}

module.exports = { SESSION_COOKIE, cookieOptions, loadSession, requireAuth, requireRole, requireCsrf };
