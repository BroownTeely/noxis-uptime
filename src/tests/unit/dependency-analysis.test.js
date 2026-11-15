'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../monitors/dependency-analysis');

// Cenário: Site -> Painel -> API -> PostgreSQL ; Site -> CDN (opcional)
function graph({ db = 'UP', api = 'UP', painel = 'UP', site = 'UP', cdn = 'UP', siteCdnRequired = false } = {}) {
  const nodes = new Map([
    [1, { id: 1, name: 'PostgreSQL', status: db, active: true }],
    [2, { id: 2, name: 'API', status: api, active: true }],
    [3, { id: 3, name: 'Painel', status: painel, active: true }],
    [4, { id: 4, name: 'Site', status: site, active: true }],
    [5, { id: 5, name: 'CDN', status: cdn, active: true }],
  ]);
  const edges = [
    { from: 2, to: 1, required: true },
    { from: 3, to: 2, required: true },
    { from: 4, to: 3, required: true },
    { from: 4, to: 5, required: siteCdnRequired },
  ];
  return { nodes, edges };
}

test('banco DOWN é causa raiz; dependentes ficam DEGRADED e são suprimidos', () => {
  const g = graph({ db: 'DOWN', api: 'DOWN', painel: 'DOWN', site: 'DOWN' });
  const index = A.buildIndex(g);
  assert.deepEqual(A.rootCauses(g, index, 1), [1]);
  assert.deepEqual(A.rootCauses(g, index, 2), [1]);
  assert.deepEqual(A.rootCauses(g, index, 4), [1]);
  assert.equal(A.decideAlert(g, 1).action, 'root');
  assert.equal(A.decideAlert(g, 2).action, 'suppress');
  assert.equal(A.decideAlert(g, 4).action, 'suppress');
});

test('estados derivados: API e Site ficam DEGRADED quando o banco cai (sem alterar DOWN próprio)', () => {
  const g = graph({ db: 'DOWN', api: 'UP', painel: 'UP', site: 'UP' });
  const index = A.buildIndex(g);
  assert.equal(A.stateOf(g, index, 2), 'DEGRADED');
  assert.equal(A.stateOf(g, index, 3), 'DEGRADED');
  assert.equal(A.stateOf(g, index, 4), 'DEGRADED');
  assert.equal(A.stateOf(g, index, 1), 'DOWN');
});

test('causa raiz e impacto aparecem na cadeia correta', () => {
  const g = graph({ db: 'DOWN', api: 'DOWN', painel: 'DOWN', site: 'DOWN' });
  const index = A.buildIndex(g);
  const decision = A.decideAlert(g, 1);
  assert.deepEqual(decision.affected.sort(), [2, 3, 4].sort());
  const chain = A.pathToRoot(index, 4, 1);
  assert.deepEqual(chain, [4, 3, 2, 1]); // Site -> Painel -> API -> PostgreSQL
});

test('sem evidência de causa raiz: queda própria sem dependências falhando é notificada normalmente', () => {
  const g = graph({ db: 'UP', api: 'DOWN', painel: 'UP', site: 'UP' });
  // API DOWN sem dependência falhando: é a própria causa raiz
  assert.equal(A.decideAlert(g, 2).action, 'root');
  // Site DOWN enquanto as dependências estão UP: a causa é o próprio Site
  const siteOnly = graph({ db: 'UP', api: 'UP', painel: 'UP', site: 'DOWN' });
  assert.deepEqual(A.rootCauses(siteOnly, A.buildIndex(siteOnly), 4), [4]);
});

test('dependência DEGRADED (não DOWN) não gera causa raiz', () => {
  const g = graph({ db: 'DEGRADED', api: 'DOWN', painel: 'UP', site: 'UP' });
  const index = A.buildIndex(g);
  assert.deepEqual(A.rootCauses(g, index, 2), [2]);
  assert.equal(A.decideAlert(g, 2).action, 'root');
});

test('dependência opcional não propaga impacto nem causa raiz', () => {
  const g = graph({ db: 'UP', api: 'UP', painel: 'UP', site: 'DOWN', cdn: 'DOWN', siteCdnRequired: false });
  const index = A.buildIndex(g);
  assert.equal(A.stateOf(g, index, 4), 'DOWN');
  assert.deepEqual(A.rootCauses(g, index, 4), [4]);
  const up = graph({ db: 'UP', api: 'UP', painel: 'UP', site: 'UP', cdn: 'DOWN', siteCdnRequired: false });
  assert.equal(A.stateOf(up, A.buildIndex(up), 4), 'UP');
});

test('detecção de ciclo impede criar dependências circulares', () => {
  const g = graph();
  const index = A.buildIndex(g);
  assert.equal(A.wouldCreateCycle(index, 1, 4), true);   // PostgreSQL -> Site fecharia ciclo
  assert.equal(A.wouldCreateCycle(index, 5, 4), true);   // CDN -> Site fecharia ciclo (Site já depende da CDN)
  assert.equal(A.wouldCreateCycle(index, 5, 1), false);  // CDN -> PostgreSQL não fecha ciclo
  assert.equal(A.wouldCreateCycle(index, 2, 2), true);   // auto-dependência
});

test('lista de dependências é recursiva e segura contra ciclos', () => {
  const g = graph({ db: 'DOWN' });
  const index = A.buildIndex(g);
  const list = A.dependencyList(g, index, 4);
  assert.deepEqual(list.map((x) => x.id), [3, 2, 1, 5]);
});

test('causa raiz cai antes dos dependentes: alerta de causa raiz lista quem está em risco', () => {
  const g = graph({ db: 'DOWN', api: 'UP', painel: 'UP', site: 'UP' });
  const d = A.decideAlert(g, 1);
  assert.equal(d.action, 'root');
  assert.deepEqual(d.affected.sort(), [2, 3, 4].sort());
});

test('dependente que cai depois da causa raiz é suprimido', () => {
  const g = graph({ db: 'DOWN', api: 'DOWN', painel: 'UP', site: 'UP' });
  assert.equal(A.decideAlert(g, 2).action, 'suppress');
});
