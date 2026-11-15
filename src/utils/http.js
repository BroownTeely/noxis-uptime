'use strict';

/** Envolve handlers async para encaminhar erros ao middleware de erro do Express. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Converte parâmetros numéricos de rota; retorna null se inválido. */
function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Gera a URL de paginação preservando filtros da query atual. */
function pageInfo(total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  return { page, perPage, total, pages, hasPrev: page > 1, hasNext: page < pages };
}

/** Pequeno wrapper de erro com status HTTP. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { asyncHandler, toId, clampInt, pageInfo, HttpError };
