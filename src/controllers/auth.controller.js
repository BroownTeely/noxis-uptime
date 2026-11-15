'use strict';

const authService = require('../services/auth.service');
const { SESSION_COOKIE, cookieOptions } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const safeNext = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/');

function setSessionCookie(res, session) {
  res.cookie(SESSION_COOKIE, session.token, cookieOptions(session.ttlMs));
}

module.exports = {
  showSetup(req, res) {
    if (!authService.needsSetup()) return res.redirect('/login');
    res.render('auth/setup', { title: 'Configuração inicial', layout: false, error: null, values: {} });
  },

  setup: asyncHandler(async (req, res) => {
    if (!authService.needsSetup()) return res.redirect('/login');
    const result = await authService.setupOwner(req.body, req);
    if (result.error) {
      return res.status(400).render('auth/setup', {
        title: 'Configuração inicial', layout: false, error: result.error, values: req.body,
      });
    }
    setSessionCookie(res, result.session);
    return res.redirect('/');
  }),

  showLogin(req, res) {
    if (authService.needsSetup()) return res.redirect('/setup');
    if (req.user) return res.redirect('/');
    res.render('auth/login', { title: 'Entrar', layout: false, error: null, next: safeNext(req.query.next), values: {} });
  },

  login: asyncHandler(async (req, res) => {
    const result = await authService.login(req.body, req);
    if (result.error) {
      return res.status(401).render('auth/login', {
        title: 'Entrar', layout: false, error: result.error, next: safeNext(req.body.next), values: req.body,
      });
    }
    setSessionCookie(res, result.session);
    return res.redirect(safeNext(req.body.next));
  }),

  logout: asyncHandler(async (req, res) => {
    authService.logout(req.cookies?.[SESSION_COOKIE], req);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.redirect('/login');
  }),

  changePassword: asyncHandler(async (req, res) => {
    const result = await authService.changePassword(req.user.id, req.body, req);
    if (result.error) return res.status(400).json({ error: result.error });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return res.json({ ok: true, redirect: '/login' });
  }),

};
