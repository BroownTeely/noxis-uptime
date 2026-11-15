/**
 * Conexão Socket.IO com reconexão automática. Ao reconectar, a página recebe
 * o evento 'resync' para buscar dados atualizados (sem F5).
 */
const listeners = new Map();
const resyncHandlers = new Set();
let socket = null;

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function onResync(handler) {
  resyncHandlers.add(handler);
  return () => resyncHandlers.delete(handler);
}

function emitLocal(event, payload) {
  listeners.get(event)?.forEach((h) => {
    try { h(payload); } catch (err) { console.error(`[socket:${event}]`, err); }
  });
}

function setConnection(state) {
  document.querySelectorAll('.conn').forEach((el) => {
    el.dataset.conn = state;
    const text = el.querySelector('.conn__text');
    if (text) text.textContent = { online: 'Conectado', offline: 'Desconectado', connecting: 'Reconectando' }[state] || state;
  });
  document.documentElement.dataset.connection = state;
}

export function connect() {
  if (typeof window.io !== 'function') {
    setConnection('offline');
    return null;
  }
  setConnection('connecting');
  socket = window.io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
    randomizationFactor: 0.4,
  });

  let hadConnection = false;
  socket.on('connect', () => {
    setConnection('online');
    if (hadConnection) {
      // Reconexão: sincroniza o estado que pode ter mudado durante a queda.
      resyncHandlers.forEach((h) => h());
      emitLocal('reconnected', {});
    }
    hadConnection = true;
  });
  socket.on('disconnect', () => setConnection('offline'));
  socket.on('connect_error', (err) => {
    setConnection(err.message === 'unauthorized' ? 'offline' : 'connecting');
    if (err.message === 'unauthorized') socket.disconnect();
  });
  socket.io.on('reconnect_attempt', () => setConnection('connecting'));

  const events = [
    'hello', 'summary', 'monitor:update', 'monitor:check', 'monitor:status',
    'event:new', 'incident:update', 'notification:update', 'system:stats', 'update:status',
  ];
  for (const ev of events) socket.on(ev, (payload) => emitLocal(ev, payload));
  return socket;
}
