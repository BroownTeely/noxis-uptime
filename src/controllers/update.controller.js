'use strict';

const { asyncHandler, HttpError } = require('../utils/http');
const updateService = require('../services/update.service');
const audit = require('../db/repositories/audit');

module.exports = {
  status: (req, res) => res.json(updateService.publicStatus()),

  check: asyncHandler(async (req, res) => {
    const status = await updateService.check({ force: true });
    audit.write({ userId: req.user.id, username: req.user.username, action: 'update.checked', ip: req.ip });
    res.json(status);
  }),

  apply: asyncHandler(async (req, res) => {
    try {
      const status = await updateService.apply(req.user, req.ip);
      res.json({ ...status, restarting: true });
    } catch (err) {
      if (err.status && err.status < 500) throw new HttpError(err.status, err.message);
      throw new HttpError(err.status || 500, err.message);
    }
  }),
};
