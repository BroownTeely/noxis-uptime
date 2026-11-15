'use strict';

const A = require('../monitors/dependency-analysis');

const NODE_W = 190;
const NODE_H = 52;
const LEVEL_GAP = 120;
const TOP = 40;

/**
 * Nível de cada monitor no mapa: 0 = topo (ninguém depende dele, ex.: aplicações);
 * cada dependência fica um nível abaixo do que depende dela.
 */
function levelsOf(graph) {
  const index = A.buildIndex(graph);
  const memo = new Map();
  const level = (id, path = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (path.has(id)) return 0; // ciclo: não deveria existir, mas não trava
    const dependents = index.dependents.get(id) || [];
    let lv = 0;
    if (dependents.length) {
      const next = new Set(path).add(id);
      lv = 1 + Math.max(...dependents.map((d) => level(d.from, next)));
    }
    memo.set(id, lv);
    return lv;
  };
  for (const id of graph.nodes.keys()) level(id);
  return { levels: memo, index };
}

/** Posiciona os nós em camadas. Retorna coordenadas prontas para SVG. */
function layout(graph) {
  const { levels, index } = levelsOf(graph);
  const byLevel = new Map();
  for (const [id, lv] of levels) {
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(id);
  }
  const maxPerLevel = Math.max(1, ...[...byLevel.values()].map((l) => l.length));
  const width = Math.max(960, maxPerLevel * (NODE_W + 40));
  const depth = Math.max(0, ...byLevel.keys());
  const height = TOP * 2 + depth * LEVEL_GAP + NODE_H;

  const nodes = [];
  for (const [lv, ids] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...ids].sort((a, b) => graph.nodes.get(a).name.localeCompare(graph.nodes.get(b).name, 'pt-BR'));
    sorted.forEach((id, i) => {
      const x = Math.round((width / (sorted.length + 1)) * (i + 1));
      const y = TOP + lv * LEVEL_GAP;
      const n = graph.nodes.get(id);
      nodes.push({ id, name: n.name, x, y, level: lv, state: A.stateOf(graph, index, id) });
    });
  }
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges
    .filter((e) => pos.has(e.from) && pos.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, required: e.required, x1: pos.get(e.from).x, y1: pos.get(e.from).y + NODE_H,
      x2: pos.get(e.to).x, y2: pos.get(e.to).y }));
  return { width, height, nodeW: NODE_W, nodeH: NODE_H, nodes, edges };
}

const mapService = {
  build: (graph) => layout(graph),
  layout,
  levelsOf,
};

module.exports = mapService;
