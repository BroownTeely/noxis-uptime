'use strict';

const { asyncHandler, HttpError } = require('../utils/http');
const discoveryService = require('../services/discovery.service');

module.exports = {
  info: (req, res) => res.json({
    commonPorts: discoveryService.COMMON_PORTS.map((p) => ({ port: p, service: discoveryService.serviceName(p) })),
    maxPorts: discoveryService.MAX_PORTS,
  }),

  scan: asyncHandler(async (req, res) => {
    try {
      const result = await discoveryService.run(req.body || {}, req.user, req.ip);
      res.json(result);
    } catch (err) {
      if (err.status) throw new HttpError(err.status, err.message);
      throw err;
    }
  }),
};
