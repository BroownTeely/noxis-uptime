'use strict';

const { runHttp } = require('./http');
const { runTcp } = require('./tcp');
const { runPing } = require('./ping');
const { runDns } = require('./dns');
const { runSsl } = require('./ssl');
const { runDocker } = require('./docker');

/**
 * Registro de verificadores por tipo. Cada função recebe (monitor, ctx) e retorna
 * { ok, latencyMs, message, details }. Novos tipos são adicionados aqui sem
 * alterar o motor de agendamento.
 */
const CHECKERS = {
  http: runHttp,
  keyword: runHttp,
  json: runHttp,
  api: runHttp,
  tcp: runTcp,
  ping: runPing,
  dns: runDns,
  ssl: runSsl,
  docker: runDocker,
  // 'push' não é executado ativamente: o motor avalia o último sinal recebido.
};

const TYPES = [
  { value: 'http', label: 'HTTP / HTTPS', description: 'Requisição HTTP com status, conteúdo e JSON' },
  { value: 'keyword', label: 'Palavra-chave', description: 'Verifica presença ou ausência de texto na resposta' },
  { value: 'json', label: 'JSON Query', description: 'Valida valor em caminho JSON da resposta' },
  { value: 'api', label: 'API (HTTP avançado)', description: 'Método, corpo JSON, autenticação (Bearer, Basic ou API key) e chaves obrigatórias' },
  { value: 'tcp', label: 'Porta TCP', description: 'Conexão TCP com host e porta' },
  { value: 'ping', label: 'PING / ICMP', description: 'Disponibilidade por ICMP' },
  { value: 'dns', label: 'DNS', description: 'Resolução de registro DNS' },
  { value: 'ssl', label: 'SSL / TLS', description: 'Validade do certificado' },
  { value: 'push', label: 'Heartbeat / Push', description: 'Sinal periódico enviado por script ou CRON' },
  { value: 'docker', label: 'Container Docker', description: 'Estado de container via Docker API (somente leitura)' },
];

function getChecker(type) {
  return CHECKERS[type] || null;
}

module.exports = { CHECKERS, TYPES, getChecker };
