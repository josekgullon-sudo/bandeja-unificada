const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const crypto = require('crypto');
const express = require('express');
const webhookWhatsapp = require('./routes/webhook-whatsapp');
const webhookTelegram = require('./routes/webhook-telegram');
const api = require('./routes/api');
const { startPolling } = require('./services/telegram');
const telegramUser = require('./services/telegram-user');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Los webhooks y el health van SIN autenticación: los llaman Meta/Telegram.
app.use('/webhook', webhookWhatsapp);
app.use('/telegram/webhook', webhookTelegram);
app.get('/health', (req, res) => res.json({ ok: true }));

// --- Autenticación de la bandeja ---
// Login con pantalla propia (cookie de sesión firmada, 30 días). Fuentes de
// credenciales: INBOX_USER/INBOX_PASS del .env (cuenta maestra) y la tabla
// de agentes (node scripts/add-user.js). La cabecera Basic sigue aceptándose
// por compatibilidad con scripts.
const fs = require('fs');
const { getAgentByUsername, countAgents } = require('./services/db');
const { verifyPassword, signSession, verifySession } = require('./services/auth');

const INBOX_USER = process.env.INBOX_USER || '';
const INBOX_PASS = process.env.INBOX_PASS || '';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'inbox_session';

// Secreto de firma de sesiones: de .env o generado y persistido en disco
// (así los reinicios no cierran la sesión de nadie).
const SECRET_PATH = path.join(__dirname, 'db', '.session-secret');
let SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  try {
    SESSION_SECRET = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  } catch {
    /* primer arranque */
  }
  if (!SESSION_SECRET) {
    SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, SESSION_SECRET, { mode: 0o600 });
  }
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Valida usuario+contraseña contra la cuenta maestra y la tabla de agentes. */
function checkCredentials(user, pass) {
  if (!user || !pass) return false;
  if (INBOX_USER && INBOX_PASS && safeEqual(user, INBOX_USER) && safeEqual(pass, INBOX_PASS)) {
    return true;
  }
  const agent = getAgentByUsername(user);
  return Boolean(agent && verifyPassword(pass, agent.password_hash));
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1));
    }
  }
  return null;
}

function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https';
}

const authRequired = Boolean((INBOX_USER && INBOX_PASS) || countAgents() > 0);
if (!authRequired) {
  console.warn(
    '[seguridad] Sin INBOX_USER/INBOX_PASS ni agentes creados: la bandeja queda SIN contraseña. ' +
    'Crea usuarios con: node scripts/add-user.js <usuario> <contraseña>'
  );
}

// Login/logout: públicos (la pantalla de login los usa antes de tener sesión)
app.post('/api/login', (req, res) => {
  const username = (req.body && req.body.username ? String(req.body.username) : '').trim();
  const password = req.body && req.body.password ? String(req.body.password) : '';
  if (!checkCredentials(username, password)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  const token = signSession(username, SESSION_SECRET, SESSION_TTL_MS);
  res.set(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; ` +
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${isSecure(req) ? '; Secure' : ''}`
  );
  res.json({ ok: true, username });
});

app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

// Protección de la API y los adjuntos. El frontend estático queda público
// (solo es la carcasa de la app: sin sesión, lo único que muestra es el login).
// Solo sesiones del login propio: la cabecera Basic que los navegadores
// guardaron del sistema antiguo se ignora a propósito (si no, "cerrar
// sesión" no cerraba nada porque el navegador reenviaba esas credenciales).
app.use(['/api', '/media'], (req, res, next) => {
  const user = verifySession(getCookie(req, SESSION_COOKIE), SESSION_SECRET);
  if (user) {
    req.agent = user;
    return next();
  }
  if (!authRequired) return next();
  return res.status(401).json({ error: 'No autenticado' });
});

app.use('/api', api);

// Adjuntos descargados (fotos, audios, documentos). Protegidos por la misma
// autenticación básica: este middleware va después del bloque de auth.
app.use('/media', express.static(path.join(__dirname, 'uploads')));

// En producción servimos el build de React desde el propio Express,
// así solo hay un proceso y un puerto que exponer en Nginx.
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get(/^\/(?!api|webhook|telegram).*/, (req, res, next) => {
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bandeja unificada escuchando en http://localhost:${PORT}`);

  if (telegramUser.enabled()) {
    // Modo cuenta personal: la bandeja se conecta como un dispositivo más
    // de la cuenta de Telegram del dueño (MTProto). Los chats privados que
    // reciba la cuenta entran en la bandeja.
    telegramUser.start().catch((err) => {
      console.error('[telegram-user] no se pudo iniciar:', err.message);
    });
  } else if (process.env.TELEGRAM_USE_WEBHOOK !== '1') {
    // Modo bot clásico por long polling (los clientes escriben al bot).
    startPolling();
  }
});
