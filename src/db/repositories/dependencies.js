'use strict';

const { getDatabase } = require('../connection');

const depsRepo = {
  /** Nós do grafo: todos os monitores (ativos e pausados). */
  nodes() {
    return getDatabase()
      .prepare('SELECT id, name, status, active FROM monitors')
      .all()
      .map((r) => ({ id: r.id, name: r.name, status: r.status, active: !!r.active }));
  },
  edges() {
    return getDatabase()
      .prepare('SELECT monitor_id AS src, depends_on_id AS dst, required FROM monitor_dependencies')
      .all()
      .map((r) => ({ from: r.src, to: r.dst, required: !!r.required }));
  },
  /** Dependências de um monitor (o que ele precisa). */
  listFor(monitorId) {
    return getDatabase().prepare(`
      SELECT d.depends_on_id AS id, d.required, m.name
      FROM monitor_dependencies d JOIN monitors m ON m.id = d.depends_on_id
      WHERE d.monitor_id = ? ORDER BY m.name COLLATE NOCASE`).all(monitorId)
      .map((r) => ({ id: r.id, name: r.name, required: !!r.required }));
  },
  /** Dependentes de um monitor (quem precisa dele). */
  dependentsOf(monitorId) {
    return getDatabase().prepare(`
      SELECT d.monitor_id AS id, d.required, m.name
      FROM monitor_dependencies d JOIN monitors m ON m.id = d.monitor_id
      WHERE d.depends_on_id = ? ORDER BY m.name COLLATE NOCASE`).all(monitorId)
      .map((r) => ({ id: r.id, name: r.name, required: !!r.required }));
  },
  insert({ monitorId, dependsOnId, required }) {
    getDatabase()
      .prepare('INSERT INTO monitor_dependencies (monitor_id, depends_on_id, required) VALUES (?, ?, ?)')
      .run(monitorId, dependsOnId, required ? 1 : 0);
  },
  remove(monitorId, dependsOnId) {
    return getDatabase()
      .prepare('DELETE FROM monitor_dependencies WHERE monitor_id = ? AND depends_on_id = ?')
      .run(monitorId, dependsOnId).changes;
  },
};

module.exports = depsRepo;
