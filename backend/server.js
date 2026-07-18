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

// --- Autenticación básica para la bandeja (interfaz + API interna) ---
// Se activa definiendo INBOX_USER e INBOX_PASS en el .env. Imprescindible
// si la bandeja está expuesta a internet.
const INBOX_USER = process.env.INBOX_USER || '';
const INBOX_PASS = process.env.INBOX_PASS || '';

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

if (INBOX_USER && INBOX_PASS) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (sep > 0 && safeEqual(user, INBOX_USER) && safeEqual(pass, INBOX_PASS)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Bandeja unificada", charset="UTF-8"');
    return res.status(401).send('Autenticación requerida');
  });
} else {
  console.warn(
    '[seguridad] INBOX_USER/INBOX_PASS no definidos: la bandeja queda SIN contraseña. ' +
    'Definelos en .env si el puerto es accesible desde internet.'
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
