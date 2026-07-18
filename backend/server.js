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

// --- Autenticación de la bandeja (interfaz + API interna) ---
// Dos fuentes de credenciales, ambas válidas a la vez:
//  1. INBOX_USER/INBOX_PASS del .env (cuenta "maestra" de emergencia)
//  2. Tabla de agentes (se crean con: node scripts/add-user.js usuario clave)
// Cada petición identifica al agente para firmar sus respuestas.
const { getAgentByUsername, countAgents } = require('./services/db');
const { verifyPassword } = require('./services/auth');

const INBOX_USER = process.env.INBOX_USER || '';
const INBOX_PASS = process.env.INBOX_PASS || '';

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Cache de tokens ya verificados para no recalcular scrypt en cada poll.
const authCache = new Map();

function authenticate(header) {
  if (!header || !header.startsWith('Basic ')) return null;
  const token = header.slice(6);
  if (authCache.has(token)) return authCache.get(token);

  const decoded = Buffer.from(token, 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep <= 0) return null;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  let ok = false;
  if (INBOX_USER && INBOX_PASS && safeEqual(user, INBOX_USER) && safeEqual(pass, INBOX_PASS)) {
    ok = true;
  } else {
    const agent = getAgentByUsername(user);
    ok = Boolean(agent && verifyPassword(pass, agent.password_hash));
  }
  if (!ok) return null;

  if (authCache.size > 200) authCache.clear();
  authCache.set(token, user);
  return user;
}

const authRequired = Boolean((INBOX_USER && INBOX_PASS) || countAgents() > 0);

if (authRequired) {
  app.use((req, res, next) => {
    const user = authenticate(req.headers.authorization);
    if (user) {
      req.agent = user;
      return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Bandeja unificada", charset="UTF-8"');
    return res.status(401).send('Autenticación requerida');
  });
} else {
  console.warn(
    '[seguridad] Sin INBOX_USER/INBOX_PASS ni agentes creados: la bandeja queda SIN contraseña. ' +
    'Crea usuarios con: node scripts/add-user.js <usuario> <contraseña>'
  );
}

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
