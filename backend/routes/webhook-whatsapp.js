const express = require('express');
const router = express.Router();
const {
  findOrCreateConversation,
  saveIncomingMessage,
  updateMessageStatusByChannelId,
} = require('../services/db');

/**
 * GET /webhook — verificación del webhook por parte de Meta.
 * Meta llama con hub.mode=subscribe, hub.verify_token y hub.challenge.
 * Si el verify_token coincide con el nuestro, devolvemos el challenge.
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[whatsapp] webhook verificado por Meta');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

function describeNonText(msg) {
  switch (msg.type) {
    case 'image': return '📷 Imagen' + (msg.image && msg.image.caption ? `: ${msg.image.caption}` : '');
    case 'audio': return msg.audio && msg.audio.voice ? '🎤 Nota de voz' : '🎵 Audio';
    case 'video': return '🎬 Vídeo' + (msg.video && msg.video.caption ? `: ${msg.video.caption}` : '');
    case 'document': return `📎 Archivo: ${(msg.document && msg.document.filename) || 'documento'}`;
    case 'sticker': return 'Sticker';
    case 'location': return '📍 Ubicación';
    case 'contacts': return '👤 Contacto compartido';
    case 'reaction': return `Reacción: ${(msg.reaction && msg.reaction.emoji) || ''}`;
    default: return `[Mensaje de tipo ${msg.type} no soportado]`;
  }
}

/**
 * POST /webhook — mensajes entrantes y actualizaciones de estado.
 * Siempre respondemos 200 rápido; si Meta no recibe 200 reintenta y puede
 * acabar desactivando el webhook.
 */
router.post('/', (req, res) => {
  res.sendStatus(200);

  try {
    const entries = (req.body && req.body.entry) || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        // Nombres de contacto que acompañan a los mensajes
        const names = {};
        for (const contact of value.contacts || []) {
          if (contact.wa_id && contact.profile && contact.profile.name) {
            names[contact.wa_id] = contact.profile.name;
          }
        }

        // Mensajes entrantes de clientes
        for (const msg of value.messages || []) {
          const from = msg.from; // número de teléfono del cliente
          const conversation = findOrCreateConversation('whatsapp', from, names[from]);
          const body = msg.type === 'text' && msg.text ? msg.text.body : describeNonText(msg);
          saveIncomingMessage(conversation.id, {
            body,
            channelMessageId: msg.id,
          });
        }

        // Estados de mensajes que enviamos (sent/delivered/read/failed)
        for (const st of value.statuses || []) {
          if (st.id && ['sent', 'delivered', 'read', 'failed'].includes(st.status)) {
            updateMessageStatusByChannelId(st.id, st.status);
            if (st.status === 'failed' && st.errors) {
              console.error('[whatsapp] mensaje fallido:', JSON.stringify(st.errors));
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp] error procesando webhook:', err);
  }
});

module.exports = router;
