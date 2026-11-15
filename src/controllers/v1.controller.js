'use strict';

const { asyncHandler, toId, HttpError } = require('../utils/http');
const monitorsRepo = require('../db/repositories/monitors');
const incidentsRepo = require('../db/repositories/incidents');
const { groupsRepo } = require('../db/repositories/notifications');
const { eventsRepo } = require('../db/repositories/checks');
const { dashboardService } = require('../services/dashboard.service');
const { validateMonitor } = require('../validators/monitor.validator');
const { createMonitorService } = require('../services/monitor.service');
const { maskConfig } = require('../validators/monitor.validator');

/**
 * API pública v1, autenticada por chave (Authorization: Bearer nxu_...).
 * Escopos: read (consulta) e write (criar, alterar e excluir monitores).
 */
function createV1Controller({ engine }) {
  const monitorService = createMonitorService(engine);
  const actor = (req) => ({ id: null, username: `api-key:${req.apiKey.id}`, role: 'admin' });
  const mask = (m) => (m ? { ...m, config: maskConfig(m.config) } : null);

  return {
    status: (req, res) => res.json({ summary: dashboardService.summary() }),
    monitors: (req, res) => res.json({ monitors: monitorsRepo.list().map(mask) }),
    monitor: asyncHandler(async (req, res) => {
      const m = monitorsRepo.findById(toId(req.params.id));
      if (!m) throw new HttpError(404, 'Monitor não encontrado');
      res.json({ monitor: mask(m) });
    }),
    createMonitor: asyncHandler(async (req, res) => {
      const result = monitorService.create(req.body, actor(req), req.ip);
      if (result.errors) throw new HttpError(422, result.errors.join(' '));
      res.status(201).json(result);
    }),
    updateMonitor: asyncHandler(async (req, res) => {
      const result = monitorService.update(toId(req.params.id), req.body, actor(req), req.ip);
      if (result.notFound) throw new HttpError(404, 'Monitor não encontrado');
      if (result.errors) throw new HttpError(422, result.errors.join(' '));
      res.json(result);
    }),
    deleteMonitor: asyncHandler(async (req, res) => {
      if (!monitorService.remove(toId(req.params.id), actor(req), req.ip)) throw new HttpError(404, 'Monitor não encontrado');
      res.json({ ok: true });
    }),
    incidents: (req, res) => res.json({ incidents: incidentsRepo.list({ limit: 100 }).rows }),
    groups: (req, res) => res.json({ groups: groupsRepo.list() }),
    events: (req, res) => res.json({ events: eventsRepo.recent({ limit: 100 }) }),
  };
}

module.exports = { createV1Controller };
