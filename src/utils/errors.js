'use strict';

/** Mensagem compreensível para o usuário a partir de erros de rede ou de validação. */
function friendlyError(err) {
  if (!err) return 'Erro desconhecido';
  if (err.name === 'AbortError') return 'Tempo esgotado ao enviar';
  if (err.name === 'BlockedTargetError') return err.message;
  const code = err.code || (err.cause && err.cause.code) || '';
  const text = `${err.message || ''} ${code}`;
  if (/ECONNREFUSED/.test(text)) return 'Conexão recusada pelo destino';
  if (/ENOTFOUND|EAI_AGAIN|DNS/.test(text)) return 'Nome do destino não encontrado (DNS)';
  if (/ETIMEDOUT|timeout/i.test(text)) return 'Tempo esgotado ao conectar ao destino';
  if (/fetch failed|ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(text)) return 'Não foi possível conectar ao destino';
  return err.message || 'Falha no envio';
}

module.exports = { friendlyError };
