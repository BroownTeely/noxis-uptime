'use strict';

/**
 * Análise pura de dependências entre monitores. Não acessa o banco.
 *
 * graph = { nodes: Map<id, {id, name, status, active}>, edges: [{from, to, required}] }
 *   from = monitor que depende de `to`.
 *
 * Regras:
 *  - Um monitor DOWN é causa raiz quando nenhuma dependência obrigatória está falhando.
 *  - Um monitor cujas dependências obrigatórias (direta ou transitivamente) estão DOWN
 *    é exibido como DEGRADED (se estiver UP) — o estado armazenado não é alterado.
 *  - Dependências opcionais não propagam impacto.
 *  - Se não houver evidência de causa raiz, o resultado é vazio ("não determinada").
 */

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function buildIndex(graph) {
  const deps = new Map();
  const dependents = new Map();
  for (const e of graph.edges) {
    push(deps, e.from, { to: e.to, required: !!e.required });
    push(dependents, e.to, { from: e.from, required: !!e.required });
  }
  return { deps, dependents };
}

const nodeOf = (graph, id) => graph.nodes.get(id);

function requiredDeps(index, id) {
  return (index.deps.get(id) || []).filter((d) => d.required).map((d) => d.to);
}

/** true se o próprio monitor ou alguma dependência obrigatória transitiva está DOWN. */
function isFailingSubtree(graph, index, id, path = new Set()) {
  if (path.has(id)) return false;
  const node = nodeOf(graph, id);
  if (!node || !node.active) return false;
  if (node.status === 'DOWN') return true;
  const next = new Set(path).add(id);
  return requiredDeps(index, id).some((d) => isFailingSubtree(graph, index, d, next));
}

/** Causas raiz que explicam a falha de `id` (lista vazia se não houver evidência). */
function rootCauses(graph, index, id, path = new Set()) {
  if (path.has(id)) return [];
  const node = nodeOf(graph, id);
  if (!node || !node.active) return [];
  const next = new Set(path).add(id);
  const failingDeps = requiredDeps(index, id).filter((d) => isFailingSubtree(graph, index, d, next));
  if (node.status === 'DOWN' && failingDeps.length === 0) return [id];
  const out = new Set();
  for (const d of failingDeps) {
    for (const r of rootCauses(graph, index, d, next)) out.add(r);
  }
  return [...out];
}

function stateOf(graph, index, id) {
  const node = nodeOf(graph, id);
  if (!node) return 'UNKNOWN';
  if (!node.active) return 'PAUSED';
  if (node.status === 'DOWN') return 'DOWN';
  const impacted = requiredDeps(index, id).some((d) => isFailingSubtree(graph, index, d, new Set([id])));
  if (impacted) return 'DEGRADED';
  return node.status;
}

/** Monitores que dependem (transitivamente, por dependência obrigatória) do `rootId`. */
function affectedBy(index, rootId) {
  const out = new Set();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop();
    for (const d of index.dependents.get(cur) || []) {
      if (d.required && d.from !== rootId && !out.has(d.from)) {
        out.add(d.from);
        stack.push(d.from);
      }
    }
  }
  return [...out];
}

/** Caminho de dependência [from, ..., root] seguindo dependências obrigatórias. */
function pathToRoot(index, from, root) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === root) {
      const path = [];
      let c = cur;
      while (c !== null) {
        path.unshift(c);
        c = prev.get(c);
      }
      return path;
    }
    for (const d of requiredDeps(index, cur)) {
      if (!prev.has(d)) {
        prev.set(d, cur);
        queue.push(d);
      }
    }
  }
  return null;
}

/** Verdadeiro se criar a dependência from -> to fecharia um ciclo. */
function wouldCreateCycle(index, from, to) {
  if (from === to) return true;
  const stack = [to];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const d of index.deps.get(cur) || []) stack.push(d.to);
  }
  return false;
}

/**
 * Decide como tratar a notificação de queda de `id`:
 *  - 'suppress': a falha é consequência de uma causa raiz diferente (não alertar em separado).
 *  - 'root':     `id` é a causa raiz e há dependentes (alerta de causa raiz com serviços potencialmente afetados).
 *  - 'notify':   alerta normal (sem evidência de cadeia de dependência).
 */
function decideAlert(graph, id) {
  const index = buildIndex(graph);
  const roots = rootCauses(graph, index, id);
  if (roots.some((r) => r !== id)) {
    return { action: 'suppress', rootCauses: roots, affected: [], chains: [] };
  }
  // Todos os dependentes (transitivos) são listados: se a causa raiz cair antes deles,
  // ainda assim o alerta informa quem está potencialmente em risco.
  const affected = affectedBy(index, id);
  if (roots.length === 1 && roots[0] === id && affected.length) {
    const chains = affected.map((a) => pathToRoot(index, a, id)).filter(Boolean);
    return { action: 'root', rootCauses: roots, affected, chains };
  }
  return { action: 'notify', rootCauses: roots, affected: [], chains: [] };
}

/** Lista plana das dependências (recursiva) com estado, para exibição em árvore. */
function dependencyList(graph, index, id, maxDepth = 6) {
  const out = [];
  const walk = (cur, depth, path) => {
    if (depth >= maxDepth) return;
    for (const d of index.deps.get(cur) || []) {
      if (path.has(d.to)) continue;
      out.push({ id: d.to, required: d.required, depth: depth + 1, state: stateOf(graph, index, d.to) });
      walk(d.to, depth + 1, new Set(path).add(d.to));
    }
  };
  walk(id, 0, new Set([id]));
  return out;
}

module.exports = {
  buildIndex, stateOf, rootCauses, affectedBy, pathToRoot,
  wouldCreateCycle, decideAlert, dependencyList,
};
