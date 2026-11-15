'use strict';

const { asyncHandler, toId, HttpError } = require('../utils/http');
const dependencyService = require('../services/dependency.service');

module.exports = {
  list: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw new HttpError(400, 'Identificador inválido');
    res.json(dependencyService.details(id));
  }),

  add: asyncHandler(async (req, res) => {
    const monitorId = toId(req.params.id);
    const dependsOnId = toId(req.body.dependsOnId);
    if (!monitorId || !dependsOnId) throw new HttpError(422, 'Informe o monitor de dependência');
    const result = dependencyService.add({ monitorId, dependsOnId, required: req.body.required !== false && req.body.required !== 'false' }, req.user, req.ip);
    if (result.error) throw new HttpError(result.status || 422, result.error);
    res.status(201).json(dependencyService.details(monitorId));
  }),

  remove: asyncHandler(async (req, res) => {
    const monitorId = toId(req.params.id);
    const depId = toId(req.params.depId);
    if (!monitorId || !depId) throw new HttpError(400, 'Identificador inválido');
    if (!dependencyService.remove(monitorId, depId, req.user, req.ip)) throw new HttpError(404, 'Dependência não encontrada');
    res.json(dependencyService.details(monitorId));
  }),
};
