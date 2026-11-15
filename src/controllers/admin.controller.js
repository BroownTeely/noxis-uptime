'use strict';

const config = require('../config');
const { asyncHandler, toId, HttpError, clampInt, pageInfo } = require('../utils/http');
const usersRepo = require('../db/repositories/users');
const settingsRepo = require('../db/repositories/settings');
const audit = require('../db/repositories/audit');
const apiKeysRepo = require('../db/repositories/apikeys');
const sessionsRepo = require('../db/repositories/sessions');
const authService = require('../services/auth.service');
const { getDatabase } = require('../db/connection');
const { dashboardService } = require('../services/dashboard.service');

const SETTINGS_SCHEMA = {
  siteName: { type: 'string', max: 80 },
  timezone: { type: 'string', max: 60 },
  checkInterval: { type: 'int', min: 10, max: 86400 },
  checkTimeout: { type: 'int', min: 1, max: 60 },
  retries: { type: 'int', min: 0, max: 10 },
  retentionDays: { type: 'int', min: 1, max: 3650 },
  allowPrivateNetworks: { type: 'bool' },
  latencyThresholdMs: { type: 'int', min: 1, max: 60000 },
  sslWarnDays: { type: 'int', min: 1, max: 180 },
  sslAlertDays: { type: 'intlist', min: 1, max: 365 },
  autoDownloadUpdates: { type: 'bool' },
};

function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  getSettings: (req, res) => res.json({ settings: settingsRepo.all(), version: config.version }),

  updateSettings: asyncHandler(async (req, res) => {
    const changes = {};
    const errors = [];
    for (const [key, rule] of Object.entries(SETTINGS_SCHEMA)) {
      if (!(key in req.body)) continue;
      const raw = req.body[key];
      if (rule.type === 'bool') {
        changes[key] = raw === true || raw === 'true' || raw === 'on';
      } else if (rule.type === 'intlist') {
        const parts = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/)).filter((x) => x !== '');
        const nums = [...new Set(parts.map((x) => Number.parseInt(x, 10)))];
        if (!nums.length || nums.length > 8 || nums.some((n) => !Number.isFinite(n) || n < rule.min || n > rule.max)) {
          errors.push(`${key}: informe de 1 a 8 valores entre ${rule.min} e ${rule.max}`);
        } else {
          changes[key] = nums.sort((a, b) => b - a);
        }
      } else if (rule.type === 'int') {
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < rule.min || n > rule.max) errors.push(`${key}: valor fora do intervalo`);
        else changes[key] = n;
      } else {
        const s = String(raw ?? '').trim().slice(0, rule.max);
        if (!s) errors.push(`${key}: obrigatório`);
        else changes[key] = s;
      }
    }
    if (changes.timezone && !validTimezone(changes.timezone)) errors.push('Fuso horário inválido');
    if (errors.length) throw new HttpError(422, errors.join('; '));
    for (const [k, v] of Object.entries(changes)) settingsRepo.set(k, v);
    audit.write({ userId: req.user.id, username: req.user.username, action: 'settings.updated', entity: 'settings',
      severity: 'notice', details: { keys: Object.keys(changes) }, ip: req.ip });
    res.json({ settings: settingsRepo.all() });
  }),

  listUsers: (req, res) => res.json({ users: usersRepo.list(), roles: usersRepo.ROLES }),

  createUser: asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    if (!authService.USERNAME_RE.test(username)) throw new HttpError(422, 'Usuário inválido');
    const pwError = authService.validatePasswordStrength(req.body.password);
    if (pwError) throw new HttpError(422, pwError);
    const role = req.body.role === 'owner' ? null : req.body.role;
    if (!role || !usersRepo.ROLES.includes(role) || role === 'owner') throw new HttpError(422, 'Papel inválido');
    if (usersRepo.findByUsername(username)) throw new HttpError(409, 'Usuário já existe');
    const { hashPassword } = require('../auth/security');
    const user = usersRepo.create({
      username, displayName: String(req.body.displayName || username).slice(0, 80),
      passwordHash: await hashPassword(req.body.password), role,
    });
    audit.write({ userId: req.user.id, username: req.user.username, action: 'user.created', entity: 'user', entityId: user.id,
      details: { role }, ip: req.ip });
    res.status(201).json({ user });
  }),

  updateUser: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const target = id && usersRepo.findById(id);
    if (!target) throw new HttpError(404, 'Usuário não encontrado');
    const changes = {};
    if (req.body.role !== undefined) {
      if (!usersRepo.ROLES.includes(req.body.role)) throw new HttpError(422, 'Papel inválido');
      if (target.role === 'owner' && req.body.role !== 'owner') {
        const owners = getDatabase().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").get().n;
        if (owners <= 1) throw new HttpError(422, 'Não é possível remover o último owner');
      }
      if (req.body.role === 'owner' && req.user.role !== 'owner') throw new HttpError(403, 'Apenas o owner pode promover outro owner');
      if (target.role === 'owner' && req.user.role !== 'owner') throw new HttpError(403, 'Apenas o owner altera outro owner');
      usersRepo.updateRole(id, req.body.role);
      changes.role = req.body.role;
    }
    if (req.body.active !== undefined) {
      if (id === req.user.id && !req.body.active) throw new HttpError(422, 'Você não pode desativar a própria conta');
      usersRepo.setActive(id, !!req.body.active);
      if (!req.body.active) sessionsRepo.removeForUser(id);
      changes.active = !!req.body.active;
    }
    audit.write({ userId: req.user.id, username: req.user.username, action: 'user.updated', entity: 'user', entityId: id,
      details: changes, severity: 'notice', ip: req.ip });
    res.json({ user: usersRepo.publicUser(usersRepo.findById(id)) });
  }),

  listApiKeys: (req, res) => res.json({ keys: apiKeysRepo.list(), scopes: apiKeysRepo.SCOPES }),

  createApiKey: asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (name.length < 2) throw new HttpError(422, 'Informe um nome para a chave');
    const scopes = (Array.isArray(req.body.scopes) ? req.body.scopes : ['read']).filter((s) => apiKeysRepo.SCOPES.includes(s));
    if (!scopes.length) throw new HttpError(422, 'Selecione ao menos um escopo');
    const created = apiKeysRepo.create({ name, scopes, userId: req.user.id });
    audit.write({ userId: req.user.id, username: req.user.username, action: 'apikey.created', entity: 'api_key',
      entityId: created.id, details: { name, scopes }, severity: 'notice', ip: req.ip });
    res.status(201).json({ key: created.key, id: created.id, note: 'Guarde esta chave agora. Ela não será exibida novamente.' });
  }),

  revokeApiKey: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(404, 'Chave não encontrada');
    apiKeysRepo.revoke(id);
    audit.write({ userId: req.user.id, username: req.user.username, action: 'apikey.revoked', entity: 'api_key',
      entityId: id, severity: 'notice', ip: req.ip });
    res.json({ ok: true });
  }),

  logs: (req, res) => {
    const page = clampInt(req.query.page, 1, 100000, 1);
    const perPage = clampInt(req.query.perPage, 10, 200, 50);
    const { rows, total } = audit.search({
      q: String(req.query.q || '').slice(0, 100),
      severity: ['info', 'notice', 'warning', 'error'].includes(req.query.severity) ? req.query.severity : '',
      entity: String(req.query.entity || '').slice(0, 40),
      limit: perPage, offset: (page - 1) * perPage,
    });
    res.json({
      logs: rows.map((r) => ({
        id: r.id, username: r.username, action: r.action, entity: r.entity, entityId: r.entity_id,
        severity: r.severity, details: r.details ? JSON.parse(r.details) : null, ip: r.ip, createdAt: r.created_at,
      })),
      pagination: pageInfo(total, page, perPage),
    });
  },

  system: (req, res) => {
    const { engine } = req.app.locals;
    res.json({
      version: config.version,
      nodeVersion: process.version,
      engine: engine.snapshot(),
      summary: dashboardService.summary(),
      uptimeSeconds: Math.round(process.uptime()),
      memoryRssMb: Math.round(process.memoryUsage().rss / 1048576),
      dbSizeKb: Math.round(require('fs').statSync(config.databasePath).size / 1024),
    });
  },
};
