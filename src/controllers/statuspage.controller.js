'use strict';

const { asyncHandler, toId, HttpError } = require('../utils/http');
const statusPageService = require('../services/statuspage.service');

module.exports = {
  list: (req, res) => res.json({ pages: statusPageService.list() }),

  get: asyncHandler(async (req, res) => {
    const page = statusPageService.findById(toId(req.params.id));
    if (!page) throw new HttpError(404, 'Página não encontrada');
    res.json({ page, items: require('../db/repositories/statuspages').items(page.id) });
  }),

  create: asyncHandler(async (req, res) => {
    const result = statusPageService.create(req.body, req.user, req.ip);
    if (result.errors) throw new HttpError(422, result.errors.join(' '));
    res.status(201).json(result);
  }),

  update: asyncHandler(async (req, res) => {
    const result = statusPageService.update(toId(req.params.id), req.body, req.user, req.ip);
    if (result.notFound) throw new HttpError(404, 'Página não encontrada');
    if (result.errors) throw new HttpError(422, result.errors.join(' '));
    res.json(result);
  }),

  regenerateToken: asyncHandler(async (req, res) => {
    const token = statusPageService.regenerateToken(toId(req.params.id), req.user, req.ip);
    if (!token) throw new HttpError(404, 'Página não encontrada');
    res.json({ token });
  }),

  remove: asyncHandler(async (req, res) => {
    if (!statusPageService.remove(toId(req.params.id), req.user, req.ip)) throw new HttpError(404, 'Página não encontrada');
    res.json({ ok: true });
  }),
};
