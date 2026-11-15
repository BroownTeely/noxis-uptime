'use strict';

const net = require('net');
const tls = require('tls');
const { assertSafeHost, parseHostPort } = require('../../utils/network');

/**
 * Lê o certificado TLS do servidor e calcula os dias restantes.
 * rejectUnauthorized é desativado apenas para inspeção: a validade é avaliada
 * manualmente através de socket.authorized e authorizationError.
 */
async function runSsl(monitor, { allowPrivate, warnDays }) {
  const { host, port } = parseHostPort(monitor.target, 443);
  await assertSafeHost(host, { allowPrivate });
  const timeoutMs = Math.max(1, monitor.timeoutSeconds) * 1000;
  const started = Date.now();

  const info = await new Promise((resolve, reject) => {
    const socket = tls.connect({
      host, port, servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false, timeout: timeoutMs,
    });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(true);
      const result = {
        authorized: socket.authorized,
        authError: socket.authorized ? null : String(socket.authorizationError),
        protocol: socket.getProtocol(),
        cert,
      };
      socket.end();
      resolve(result);
    });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
    socket.once('error', (err) => reject(err));
  }).catch((err) => ({ error: err.code || err.message }));

  const latencyMs = Date.now() - started;
  if (info.error) {
    return { ok: false, latencyMs: null, message: `Falha TLS: ${info.error}`, details: { host, port } };
  }

  const cert = info.cert || {};
  const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
  const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
  const daysLeft = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86400000) : null;
  const issuer = cert.issuer?.O || cert.issuer?.CN || 'desconhecido';
  const subject = cert.subject?.CN || host;

  const problems = [];
  if (info.authError) problems.push(info.authError);
  if (daysLeft !== null && daysLeft < 0) problems.push('certificado expirado');

  const ok = problems.length === 0;
  const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= warnDays;
  let message;
  if (!ok) message = `Certificado inválido: ${problems.join('; ')}`;
  else if (expiringSoon) message = `Expira em ${daysLeft} dia(s)`;
  else message = `Válido por mais ${daysLeft} dia(s)`;

  return {
    ok,
    latencyMs,
    message,
    details: {
      issuer, subject, validFrom: validFrom?.toISOString() || null,
      validTo: validTo?.toISOString() || null, daysLeft, protocol: info.protocol,
      chainValid: info.authorized, problems, expiringSoon,
    },
  };
}

module.exports = { runSsl };
