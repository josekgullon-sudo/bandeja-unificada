const crypto = require('crypto');

/**
 * Hash de contraseñas con scrypt: "scrypt$<salt-hex>$<hash-hex>".
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/**
 * Sesiones firmadas (cookie): token "user_b64url.expiración.firma_hmac".
 * Sin estado en servidor: la firma con el secreto valida el token.
 */
function signSession(username, secret, ttlMs) {
  const expires = Date.now() + ttlMs;
  const payload = `${Buffer.from(username, 'utf8').toString('base64url')}.${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userB64, expStr, sig] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${userB64}.${expStr}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  if (Date.now() > Number(expStr)) return null;
  return Buffer.from(userB64, 'base64url').toString('utf8');
}

module.exports = { hashPassword, verifyPassword, signSession, verifySession };
