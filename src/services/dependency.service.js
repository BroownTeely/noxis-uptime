'use strict';

const depsRepo = require('../db/repositories/dependencies');
const audit = require('../db/repositories/audit');
const A = require('../monitors/dependency-analysis');

/** Snapshot do grafo a partir do banco. */
function snapshot() {
  const nodes = new Map(depsRepo.nodes().map((n) => [n.id, n]));
  return { nodes, edges: depsRepo.edges() };
}

const nameOf = (graph, id) => graph.nodes.get(id)?.name || `#${id}`;

const dependencyService = {
  /** Grafo completo (nós e arestas) para análises e visualização. */
  graph: () => snapshot(),

  /**
   * Decisão de alerta para uma queda, com nomes prontos para exibição.
   * action: 'notify' | 'root' | 'suppress'
   */
  decideAlert(monitorId) {
    const graph = snapshot();
    const d = A.decideAlert(graph, monitorId);
    return {
      action: d.action,
      rootCauses: d.rootCauses.map((id) => nameOf(graph, id)),
      affected: d.affected.map((id) => ({ id, name: nameOf(graph, id) })),
      chains: d.chains.map((chain) => chain.map((id) => nameOf(graph, id)).join(' → ')),
    };
  },

  /** Estado derivado e causa raiz de um monitor, para a interface. */
  analysisFor(monitorId) {
    const graph = snapshot();
    const index = A.buildIndex(graph);
    const roots = A.rootCauses(graph, index, monitorId);
    return {
      state: A.stateOf(graph, index, monitorId),
      rootCauses: roots.filter((r) => r !== monitorId).map((id) => ({ id, name: nameOf(graph, id) })),
      affected: A.affectedBy(index, monitorId).map((id) => ({ id, name: nameOf(graph, id), state: A.stateOf(graph, index, id) })),
    };
  },

  /** Estado derivado de todos os monitores (usado por status pages). */
  statesOf(ids) {
    const graph = snapshot();
    const index = A.buildIndex(graph);
    const out = new Map();
    for (const id of ids) out.set(id, A.stateOf(graph, index, id));
    return out;
  },

  affectedBy(monitorId) {
    const graph = snapshot();
    return A.affectedBy(A.buildIndex(graph), monitorId);
  },

  /** Dados completos para a tela do monitor. */
  details(monitorId) {
    const graph = snapshot();
    const index = A.buildIndex(graph);
    const roots = A.rootCauses(graph, index, monitorId);
    return {
      dependsOn: depsRepo.listFor(monitorId),
      dependents: depsRepo.dependentsOf(monitorId),
      state: A.stateOf(graph, index, monitorId),
      rootCauses: roots.filter((r) => r !== monitorId).map((id) => nameOf(graph, id)),
      tree: A.dependencyList(graph, index, monitorId).map((n) => ({
        id: n.id, name: nameOf(graph, n.id), required: n.required, depth: n.depth, state: n.state,
      })),
    };
  },

  /** Adiciona dependência com validações. Retorna { error, status } em caso de falha. */
  add({ monitorId, dependsOnId, required }, user, ip) {
    const graph = snapshot();
    if (!graph.nodes.has(monitorId) || !graph.nodes.has(dependsOnId)) {
      return { error: 'Monitor não encontrado', status: 404 };
    }
    if (monitorId === dependsOnId) return { error: 'Um monitor não pode depender de si mesmo', status: 422 };
    if (depsRepo.listFor(monitorId).some((d) => d.id === dependsOnId)) {
      return { error: 'Esta dependência já existe', status: 409 };
    }
    const index = A.buildIndex(graph);
    if (A.wouldCreateCycle(index, monitorId, dependsOnId)) {
      return { error: 'Dependência recusada: criaria um ciclo entre monitores', status: 422 };
    }
    depsRepo.insert({ monitorId, dependsOnId, required: required !== false });
    audit.write({ userId: user.id, username: user.username, action: 'dependency.added', entity: 'monitor',
      entityId: monitorId, details: { dependsOnId, required: required !== false }, ip });
    return { ok: true };
  },

  remove(monitorId, dependsOnId, user, ip) {
    const changes = depsRepo.remove(monitorId, dependsOnId);
    if (changes) {
      audit.write({ userId: user.id, username: user.username, action: 'dependency.removed', entity: 'monitor',
        entityId: monitorId, details: { dependsOnId }, ip });
    }
    return changes > 0;
  },
};

module.exports = dependencyService;
