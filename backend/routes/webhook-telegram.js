const express = require('express');
const router = express.Router();
const { handleUpdate } = require('../services/telegram');

/**
 * POST /telegram/webhook — alternativa al long polling.
 * Solo se usa si en el futuro se registra un webhook con setWebhook;
 * por defecto la app funciona con polling y este endpoint queda inactivo.
 */
router.post('/', (req, res) => {
  res.sendStatus(200);
  try {
    if (req.body) handleUpdate(req.body);
  } catch (err) {
    console.error('[telegram] error procesando webhook:', err);
  }
});

module.exports = router;
