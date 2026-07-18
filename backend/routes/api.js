const express = require('express');
const router = express.Router();
const {
  listConversations,
  getConversation,
  listMessages,
  markConversationRead,
  saveOutgoingMessage,
} = require('../services/db');
const telegram = require('../services/telegram');
const whatsapp = require('../services/whatsapp');

/**
 * GET /api/conversations — lista ordenada por último mensaje, con snippet
 * del último mensaje y, para WhatsApp, el estado de la ventana de 24h.
 */
router.get('/conversations', (req, res) => {
  const conversations = listConversations().map((c) => ({
    ...c,
    unread: Boolean(c.unread),
    whatsapp_window: c.channel === 'whatsapp' ? whatsapp.windowInfo(c.last_customer_message_at) : null,
  }));
  res.json(conversations);
});

/**
 * GET /api/conversations/:id/messages — historial completo del hilo.
 */
router.get('/conversations/:id/messages', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });
  res.json({
    conversation: {
      ...conversation,
      unread: Boolean(conversation.unread),
      whatsapp_window:
        conversation.channel === 'whatsapp'
          ? whatsapp.windowInfo(conversation.last_customer_message_at)
          : null,
    },
    messages: listMessages(conversation.id),
  });
});

/**
 * POST /api/conversations/:id/reply — envía una respuesta por el canal de la
 * conversación. Solo se ejecuta cuando un agente humano pulsa enviar.
 */
router.post('/conversations/:id/reply', async (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });

  const body = (req.body && typeof req.body.body === 'string' ? req.body.body : '').trim();
  if (!body) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });

  try {
    let channelMessageId = null;

    if (conversation.channel === 'telegram') {
      channelMessageId = await telegram.sendMessage(conversation.external_id, body);
    } else if (conversation.channel === 'whatsapp') {
      const win = whatsapp.windowInfo(conversation.last_customer_message_at);
      if (!win.open) {
        return res.status(409).json({
          error:
            'Ventana de 24h cerrada: WhatsApp no permite texto libre. ' +
            'Requiere plantilla aprobada (pendiente para una versión futura).',
          window: win,
        });
      }
      channelMessageId = await whatsapp.sendText(conversation.external_id, body);
    } else {
      return res.status(400).json({ error: `Canal desconocido: ${conversation.channel}` });
    }

    const messageId = saveOutgoingMessage(conversation.id, {
      body,
      channelMessageId,
      status: 'sent',
    });

    res.json({ ok: true, message_id: messageId });
  } catch (err) {
    console.error(`[reply] error enviando por ${conversation.channel}:`, err.message);
    res.status(502).json({ error: `No se pudo enviar: ${err.message}` });
  }
});

/**
 * POST /api/conversations/:id/read — marcar como leída.
 */
router.post('/conversations/:id/read', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });
  markConversationRead(conversation.id);
  res.json({ ok: true });
});

module.exports = router;
