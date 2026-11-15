'use strict';

const { asyncHandler, toId, HttpError, clampInt } = require('../utils/http');
const incidentsRepo = require('../db/repositories/incidents');
const audit = require('../db/repositories/audit');
const maintenanceService = require('../services/maintenance.service');
const { incidentActions } = require('../incidents/manager');
const { groupsRepo } = require('../db/repositories/notifications');

const parseIso = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

module.exports = {
  list: asyncHandler(async (req, res) => {
    const open = req.query.state === 'open' ? true : req.query.state === 'resolved' ? false : null;
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const offset = clampInt(req.query.offset, 0, 100000, 0);
    const { rows, total } = incidentsRepo.list({ open, limit, offset });
    res.json({ incidents: rows, total });
  }),

  get: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const incident = id && incidentsRepo.findById(id);
    if (!incident) throw new HttpError(404, 'Incidente não encontrado');
    res.json({ incident, updates: incidentsRepo.updates(id) });
  }),

  acknowledge: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const incident = incidentActions.acknowledge(id, req.user.id);
    if (!incident) throw new HttpError(404, 'Incidente não encontrado');
    audit.write({ userId: req.user.id, username: req.user.username, action: 'incident.acknowledged', entity: 'incident', entityId: id, ip: req.ip });
    res.json({ incident });
  }),

  update: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const status = ['investigating', 'identified', 'monitoring', 'resolved'].includes(req.body.status) ? req.body.status : null;
    const severity = ['minor', 'major', 'critical'].includes(req.body.severity) ? req.body.severity : null;
    const message = String(req.body.message || '').trim().slice(0, 2000);
    if (!incidentsRepo.findById(id)) throw new HttpError(404, 'Incidente não encontrado');
    if (!status && !severity && !message) throw new HttpError(422, 'Nada para atualizar');
    const incident = incidentActions.update(id, { status, severity, message, userId: req.user.id });
    audit.write({ userId: req.user.id, username: req.user.username, action: 'incident.updated', entity: 'incident',
      entityId: id, details: { status, severity }, ip: req.ip });
    res.json({ incident });
  }),

  comment: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const message = String(req.body.message || '').trim().slice(0, 2000);
    if (!message) throw new HttpError(422, 'Comentário vazio');
    if (!incidentsRepo.findById(id)) throw new HttpError(404, 'Incidente não encontrado');
    res.status(201).json({ incident: incidentActions.comment(id, { message, userId: req.user.id }) });
  }),

  resolve: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!incidentsRepo.findById(id)) throw new HttpError(404, 'Incidente não encontrado');
    const incident = incidentActions.resolve(id, {
      userId: req.user.id, message: String(req.body.message || '').trim().slice(0, 2000) || undefined,
    });
    audit.write({ userId: req.user.id, username: req.user.username, action: 'incident.resolved_manually',
      entity: 'incident', entityId: id, severity: 'notice', ip: req.ip });
    res.json({ incident });
  }),

  listMaintenance: (req, res) => res.json({ maintenance: maintenanceService.list() }),

  createMaintenance: asyncHandler(async (req, res) => {
    const title = String(req.body.title || '').trim().slice(0, 120);
    const startsAt = parseIso(req.body.startsAt);
    const endsAt = parseIso(req.body.endsAt);
    if (title.length < 2) throw new HttpError(422, 'Informe um título');
    if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new HttpError(422, 'Período inválido: o término deve ser posterior ao início');
    }
    const monitorIds = (Array.isArray(req.body.monitorIds) ? req.body.monitorIds : []).map(Number).filter(Number.isInteger);
    const groupIds = (Array.isArray(req.body.groupIds) ? req.body.groupIds : []).map(Number).filter(Number.isInteger);
    if (!monitorIds.length && !groupIds.length) throw new HttpError(422, 'Selecione ao menos um monitor ou grupo');
    const maintenance = maintenanceService.create({
      title, description: String(req.body.description || '').slice(0, 1000), startsAt, endsAt,
      monitorIds, groupIds, userId: req.user.id,
    });
    audit.write({ userId: req.user.id, username: req.user.username, action: 'maintenance.created', entity: 'maintenance',
      entityId: maintenance.id, details: { title }, ip: req.ip });
    res.status(201).json({ maintenance });
  }),

  removeMaintenance: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!maintenanceService.findById(id)) throw new HttpError(404, 'Manutenção não encontrada');
    maintenanceService.remove(id);
    audit.write({ userId: req.user.id, username: req.user.username, action: 'maintenance.deleted', entity: 'maintenance',
      entityId: id, ip: req.ip });
    res.json({ ok: true });
  }),

  groups: (req, res) => res.json({ groups: groupsRepo.list() }),
};
