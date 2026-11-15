'use strict';

const bus = require('../events/bus');
const incidentsRepo = require('../db/repositories/incidents');

/**
 * Cria e resolve incidentes automaticamente a partir das transições de estado.
 * Um monitor possui no máximo um incidente aberto por vez.
 * Manutenções não geram incidentes.
 */
function registerIncidentManager() {
  bus.on('monitor:status', ({ monitor, previous, next, message, checkedAt, durationSeconds }) => {
    if (next === 'MAINTENANCE') return;

    if (next === 'DOWN' && previous !== 'DOWN') {
      if (incidentsRepo.openForMonitor(monitor.id)) return;
      const incident = incidentsRepo.create({
        monitorId: monitor.id,
        title: `${monitor.name} indisponível`,
        description: message || 'Falha detectada pelo monitor.',
        severity: 'critical',
        startedAt: checkedAt,
      });
      incidentsRepo.addUpdate({
        incidentId: incident.id, status: 'investigating',
        message: 'Incidente aberto automaticamente após confirmação de falha.',
      });
      bus.emit('incident:opened', { incident: incidentsRepo.findById(incident.id), monitor });
      return;
    }

    if (previous === 'DOWN' && (next === 'UP' || next === 'DEGRADED')) {
      const open = incidentsRepo.openForMonitor(monitor.id);
      if (!open) return;
      incidentsRepo.addUpdate({
        incidentId: open.id, status: 'resolved',
        message: `Serviço recuperado automaticamente após ${durationSeconds ?? 0}s de indisponibilidade.`,
      });
      const resolved = incidentsRepo.resolve(open.id, { resolvedAt: checkedAt });
      bus.emit('incident:resolved', { incident: resolved, monitor });
    }
  });
}

/** Operações manuais chamadas pelos controladores (com auditoria pelo chamador). */
const incidentActions = {
  acknowledge(incidentId, userId) {
    const incident = incidentsRepo.acknowledge(incidentId, userId);
    if (incident) bus.emit('incident:updated', { incident });
    return incident;
  },
  update(incidentId, { status, severity, message, userId }) {
    const current = incidentsRepo.findById(incidentId);
    if (!current) return null;
    if (status === 'resolved') return incidentActions.resolve(incidentId, { userId, message });
    const incident = incidentsRepo.update(incidentId, { status, severity });
    incidentsRepo.addUpdate({ incidentId, status, message: message || 'Atualização de status', userId });
    bus.emit('incident:updated', { incident: incidentsRepo.findById(incidentId) });
    return incident;
  },
  comment(incidentId, { message, userId }) {
    incidentsRepo.addUpdate({ incidentId, status: null, message, userId });
    return incidentsRepo.findById(incidentId);
  },
  resolve(incidentId, { userId, message }) {
    const current = incidentsRepo.findById(incidentId);
    if (!current || current.status === 'resolved') return current;
    incidentsRepo.addUpdate({
      incidentId, status: 'resolved',
      message: message || 'Incidente resolvido manualmente.', userId,
    });
    const incident = incidentsRepo.resolve(incidentId, { userId, resolvedAt: new Date().toISOString() });
    bus.emit('incident:resolved', { incident, monitor: null });
    return incident;
  },
};

module.exports = { registerIncidentManager, incidentActions };
