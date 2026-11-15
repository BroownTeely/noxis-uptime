'use strict';

const { asyncHandler, toId, HttpError } = require('../utils/http');
const { getChecker } = require('../monitors/checks');
const { validateMonitor } = require('../validators/monitor.validator');
const { withTimeout } = require('../monitors/engine');
const settingsRepo = require('../db/repositories/settings');
const { groupsRepo } = require('../db/repositories/notifications');

function requireMonitorId(req) {
  const id = toId(req.params.id);
  if (!id) throw new HttpError(400, 'Identificador inválido');
  return id;
}

/** Cria o controlador de monitores com o serviço e o motor injetados. */
function createMonitorController({ monitorService, engine }) {
  return {
    list: asyncHandler(async (req, res) => {
      const groupId = toId(req.query.groupId);
      const status = req.query.status ? String(req.query.status).toUpperCase() : null;
      const tag = req.query.tag ? String(req.query.tag).toLowerCase().slice(0, 32) : null;
      res.json({ monitors: monitorService.list({ groupId, status, tag }) });
    }),

    get: asyncHandler(async (req, res) => {
      const detail = monitorService.get(requireMonitorId(req));
      if (!detail) throw new HttpError(404, 'Monitor não encontrado');
      res.json(detail);
    }),

    create: asyncHandler(async (req, res) => {
      const result = monitorService.create(req.body, req.user, req.ip);
      if (result.errors) return res.status(422).json({ errors: result.errors });
      res.status(201).json(result);
    }),

    update: asyncHandler(async (req, res) => {
      const result = monitorService.update(requireMonitorId(req), req.body, req.user, req.ip);
      if (result.notFound) throw new HttpError(404, 'Monitor não encontrado');
      if (result.errors) return res.status(422).json({ errors: result.errors });
      res.json(result);
    }),

    duplicate: asyncHandler(async (req, res) => {
      const result = monitorService.duplicate(requireMonitorId(req), req.user, req.ip);
      if (result.notFound) throw new HttpError(404, 'Monitor não encontrado');
      res.status(201).json(result);
    }),

    remove: asyncHandler(async (req, res) => {
      if (!monitorService.remove(requireMonitorId(req), req.user, req.ip)) throw new HttpError(404, 'Monitor não encontrado');
      res.json({ ok: true });
    }),

    pause: asyncHandler(async (req, res) => {
      const monitor = monitorService.setActive(requireMonitorId(req), false, req.user, req.ip);
      if (!monitor) throw new HttpError(404, 'Monitor não encontrado');
      res.json({ monitor });
    }),

    resume: asyncHandler(async (req, res) => {
      const monitor = monitorService.setActive(requireMonitorId(req), true, req.user, req.ip);
      if (!monitor) throw new HttpError(404, 'Monitor não encontrado');
      res.json({ monitor });
    }),

    runNow: asyncHandler(async (req, res) => {
      if (!monitorService.runNow(requireMonitorId(req), req.user, req.ip)) throw new HttpError(404, 'Monitor não encontrado');
      res.json({ ok: true, queued: true });
    }),

    rotatePush: asyncHandler(async (req, res) => {
      const token = monitorService.rotatePushToken(requireMonitorId(req), req.user, req.ip);
      if (!token) throw new HttpError(400, 'Apenas monitores do tipo heartbeat possuem token');
      res.json({ token });
    }),

    /** Executa a verificação com a configuração do formulário, sem salvar nada. */
    test: asyncHandler(async (req, res) => {
      const { value, errors } = validateMonitor({ name: 'Teste', ...req.body, name: req.body.name || 'Teste' });
      if (errors.length) return res.status(422).json({ errors });
      const checker = getChecker(value.type);
      if (!checker) return res.json({ ok: true, message: 'Tipo sem verificação ativa (heartbeat)', latencyMs: null });
      const settings = settingsRepo.all();
      const monitor = { id: 0, ...value, timeoutSeconds: value.timeoutSeconds, consecutiveFailures: 0 };
      const result = await withTimeout(
        (signal) => checker(monitor, { signal, allowPrivate: !!settings.allowPrivateNetworks, warnDays: settings.sslWarnDays }),
        value.timeoutSeconds * 1000
      );
      res.json({ ...result, details: result.details || {} });
    }),
  };
}

/** Controlador de grupos (CRUD simples). */
const groupController = {
  list: (req, res) => res.json({ groups: groupsRepo.list() }),
  create: asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (name.length < 2) throw new HttpError(422, 'Informe um nome com pelo menos 2 caracteres');
    try {
      const group = groupsRepo.create({ name, description: String(req.body.description || '').slice(0, 200) });
      res.status(201).json({ group });
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) throw new HttpError(409, 'Já existe um grupo com esse nome');
      throw err;
    }
  }),
  update: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const current = id && groupsRepo.findById(id);
    if (!current) throw new HttpError(404, 'Grupo não encontrado');
    const name = String(req.body.name || current.name).trim().slice(0, 80);
    const group = groupsRepo.update(id, { name, description: String(req.body.description ?? current.description ?? '').slice(0, 200) });
    res.json({ group });
  }),
  remove: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id || !groupsRepo.findById(id)) throw new HttpError(404, 'Grupo não encontrado');
    groupsRepo.remove(id);
    res.json({ ok: true });
  }),
};

module.exports = { createMonitorController, groupController };
