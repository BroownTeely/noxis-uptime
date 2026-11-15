'use strict';

const { EventEmitter } = require('events');

/**
 * Barramento interno de eventos. Módulos (incidentes, notificações, sockets)
 * se inscrevem nos eventos sem depender uns dos outros.
 *
 * Eventos principais:
 *  - monitor:changed        { monitor }                 estado/config atualizado
 *  - monitor:checked        { monitor, result }         resultado de cada verificação
 *  - monitor:status         { monitor, previous, next, message, durationSeconds }
 *  - monitor:ssl-expiring   { monitor, daysLeft }
 *  - monitor:latency-high   { monitor, latencyMs }
 *  - monitor:heartbeat-missed { monitor }
 *  - incident:opened / incident:updated / incident:resolved  { incident }
 *  - notification:sent      { channelId, event }
 */
class AppBus extends EventEmitter {}

const bus = new AppBus();
bus.setMaxListeners(50);

module.exports = bus;
