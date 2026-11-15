'use strict';

const config = require('../config');
const usersRepo = require('../db/repositories/users');
const sessionsRepo = require('../db/repositories/sessions');
const audit = require('../db/repositories/audit');
const { hashPassword, verifyPassword, generateToken, sha256 } = require('../auth/security');

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

// Hash fictício usado para equalizar o tempo de resposta quando o usuário não existe.
let dummyHashPromise = null;
const dummyHash = () => (dummyHashPromise ||= hashPassword('noxis-dummy-password'));

function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (password.length > 256) return 'A senha é longa demais.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'A senha deve conter letras e números.';
  return null;
}

async function createSession(userId, req) {
  const { token, hash } = generateToken(32);
  const csrf = generateToken(24).token;
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000).toISOString();
  sessionsRepo.create({
    id: hash, userId, csrfToken: csrf,
    ip: req.ip, userAgent: req.get('user-agent'), expiresAt: expires,
  });
  return { token, ttlMs: config.sessionTtlHours * 3600 * 1000 };
}

const authService = {
  needsSetup() {
    return usersRepo.count() === 0;
  },

  async setupOwner({ username, displayName, password, confirm }, req) {
    if (!authService.needsSetup()) return { error: 'O sistema já foi configurado.' };
    if (!USERNAME_RE.test(username || '')) return { error: 'Usuário: 3 a 32 caracteres (letras, números, ponto, traço ou sublinhado).' };
    if (password !== confirm) return { error: 'As senhas não conferem.' };
    const pwError = validatePasswordStrength(password);
    if (pwError) return { error: pwError };
    const user = usersRepo.create({
      username, displayName: (displayName || username).slice(0, 80),
      passwordHash: await hashPassword(password), role: 'owner',
    });
    audit.write({ userId: user.id, username: user.username, action: 'auth.setup', entity: 'user', entityId: user.id, ip: req.ip });
    return { user, session: await createSession(user.id, req) };
  },

  async login({ username, password }, req) {
    const row = usersRepo.findByUsername(String(username || '').trim());
    const storedHash = row ? row.password_hash : await dummyHash();
    const valid = await verifyPassword(String(password || ''), storedHash);
    if (!row || !valid || !row.active) {
      audit.write({ username: String(username || '').slice(0, 64), action: 'auth.login.failed', severity: 'warning', ip: req.ip });
      return { error: 'Usuário ou senha inválidos.' };
    }
    usersRepo.touchLogin(row.id);
    audit.write({ userId: row.id, username: row.username, action: 'auth.login', ip: req.ip });
    return { user: usersRepo.publicUser(row), session: await createSession(row.id, req) };
  },

  logout(token, req) {
    if (!token) return;
    const hash = sha256(token);
    const session = sessionsRepo.findValid(hash);
    sessionsRepo.remove(hash);
    if (session) audit.write({ userId: session.user_id, username: session.username, action: 'auth.logout', ip: req.ip });
  },

  async changePassword(userId, { current, next, confirm }, req) {
    const row = usersRepo.findById(userId);
    if (!row) return { error: 'Usuário não encontrado.' };
    if (!(await verifyPassword(String(current || ''), row.password_hash))) return { error: 'Senha atual incorreta.' };
    if (next !== confirm) return { error: 'As senhas não conferem.' };
    const pwError = validatePasswordStrength(next);
    if (pwError) return { error: pwError };
    usersRepo.setPasswordHash(userId, await hashPassword(next));
    sessionsRepo.removeForUser(userId);
    audit.write({ userId, username: row.username, action: 'auth.password.changed', severity: 'notice', ip: req.ip });
    return { ok: true };
  },

  validatePasswordStrength,
  USERNAME_RE,
};

module.exports = authService;
