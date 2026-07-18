const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const webhookWhatsapp = require('./routes/webhook-whatsapp');
const webhookTelegram = require('./routes/webhook-telegram');
const api = require('./routes/api');
const { startPolling } = require('./services/telegram');

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/webhook', webhookWhatsapp);
app.use('/telegram/webhook', webhookTelegram);
app.use('/api', api);

app.get('/health', (req, res) => res.json({ ok: true }));

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

  // Telegram por long polling: no requiere HTTPS ni URL pública.
  // Para usar webhook en su lugar, poner TELEGRAM_USE_WEBHOOK=1 y registrar
  // la URL con setWebhook.
  if (process.env.TELEGRAM_USE_WEBHOOK !== '1') {
    startPolling();
  }
});
