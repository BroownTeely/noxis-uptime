'use strict';

const { asyncHandler, HttpError } = require('../utils/http');
const backupService = require('../services/backup.service');
const audit = require('../db/repositories/audit');

module.exports = {
  list: (req, res) => res.json({ backups: backupService.list() }),

  create: asyncHandler(async (req, res) => {
    const backup = backupService.create();
    audit.write({ userId: req.user.id, username: req.user.username, action: 'backup.created', entity: 'backup',
      entityId: backup.name, details: { sizeKb: backup.sizeKb }, severity: 'notice', ip: req.ip });
    res.status(201).json({ backup });
  }),

  download: asyncHandler(async (req, res) => {
    const file = backupService.resolve(req.params.name);
    if (!file) throw new HttpError(404, 'Backup não encontrado');
    audit.write({ userId: req.user.id, username: req.user.username, action: 'backup.downloaded', entity: 'backup',
      entityId: req.params.name, severity: 'notice', ip: req.ip });
    res.download(file, req.params.name);
  }),
};
