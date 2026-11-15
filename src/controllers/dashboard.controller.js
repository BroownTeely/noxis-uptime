'use strict';

const { asyncHandler, toId, HttpError } = require('../utils/http');
const { dashboardService } = require('../services/dashboard.service');
const reportService = require('../services/report.service');
const monitorsRepo = require('../db/repositories/monitors');
const audit = require('../db/repositories/audit');

const RANGES = ['24h', '7d', '30d', '90d'];

module.exports = {
  summary: (req, res) => res.json({ summary: dashboardService.summary() }),

  availability: (req, res) => {
    const range = RANGES.includes(req.query.range) ? req.query.range : '24h';
    res.json(dashboardService.availabilitySeries(range));
  },

  incidents: (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    res.json({ days, points: dashboardService.incidentSeries(days) });
  },

  overview: (req, res) => res.json({
    summary: dashboardService.summary(),
    rankings: dashboardService.rankings(),
    groups: dashboardService.groupSummary(),
    activity: dashboardService.activity(15),
    incidents: dashboardService.latestIncidents(5),
  }),

  report: asyncHandler(async (req, res) => {
    const period = reportService.periods.includes(req.query.period) ? req.query.period : '7d';
    const groupId = toId(req.query.groupId);
    const from = req.query.from && !Number.isNaN(Date.parse(req.query.from)) ? req.query.from : null;
    const to = req.query.to && !Number.isNaN(Date.parse(req.query.to)) ? req.query.to : null;
    const data = reportService.report({ period, from, to, groupId });
    res.json(data);
  }),

  reportCsv: asyncHandler(async (req, res) => {
    const period = reportService.periods.includes(req.query.period) ? req.query.period : '7d';
    const data = reportService.report({ period, groupId: toId(req.query.groupId) });
    audit.write({ userId: req.user.id, username: req.user.username, action: 'report.exported', entity: 'report', details: { period, format: 'csv' }, ip: req.ip });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="noxis-relatorio-${period}.csv"`);
    res.send(reportService.toCsv(data));
  }),

  monitorEvents: asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!monitorsRepo.findById(id)) throw new HttpError(404, 'Monitor não encontrado');
    res.json({ events: reportService.recentEvents(id, 100) });
  }),
};
