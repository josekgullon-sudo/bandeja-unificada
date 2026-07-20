const express = require('express');
const router = express.Router();
const {
  listConversations,
  lastOutgoingInfo,
  getConversation,
  listMessages,
  markConversationRead,
  saveOutgoingMessage,
  setConversationNotes,
  setConversationArchived,
  listQuickReplies,
  addQuickReply,
  deleteQuickReply,
} = require('../services/db');
const telegram = require('../services/telegram');
const telegramUser = require('../services/telegram-user');
const whatsapp = require('../services/whatsapp');

// Ventana de "en atención": si alguien respondió hace menos de X minutos,
// los demás agentes ven el aviso para no pisarse. Configurable con
// ATTEND_MINUTES en el .env (por defecto 10).
const ATTEND_MS = parseInt(process.env.ATTEND_MINUTES || '10', 10) * 60 * 1000;

function attendingFrom(lastOutAgent, lastOutAt) {
  if (!lastOutAt) return null;
  const elapsed = Date.now() - Date.parse(lastOutAt);
  if (elapsed >= ATTEND_MS) return null;
  return {
    agent: lastOutAgent || 'móvil',
    at: lastOutAt,
    elapsed_ms: elapsed,
  };
}

/**
 * GET /api/me — identidad del agente autenticado (para la interfaz).
 */
router.get('/me', (req, res) => {
  res.json({ username: req.agent || null });
});

/**
 * GET /api/conversations — lista ordenada por último mensaje, con snippet
 * del último mensaje y, para WhatsApp, el estado de la ventana de 24h.
 */
router.get('/conversations', (req, res) => {
  const conversations = listConversations().map((c) => {
    const { last_out_agent, last_out_at, ...rest } = c;
    return {
      ...rest,
      unread: Boolean(c.unread),
      whatsapp_window: c.channel === 'whatsapp' ? whatsapp.windowInfo(c.last_customer_message_at) : null,
      attending: attendingFrom(last_out_agent, last_out_at),
    };
  });
  res.json(conversations);
});

/**
 * GET /api/conversations/:id/messages — historial completo del hilo.
 */
router.get('/conversations/:id/messages', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });
  const lastOut = lastOutgoingInfo(conversation.id) || {};
  res.json({
    conversation: {
      ...conversation,
      unread: Boolean(conversation.unread),
      whatsapp_window:
        conversation.channel === 'whatsapp'
          ? whatsapp.windowInfo(conversation.last_customer_message_at)
          : null,
      attending: attendingFrom(lastOut.last_out_agent, lastOut.last_out_at),
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
      // Con sesión de cuenta personal se responde en nombre del dueño;
      // si no, se usa el bot clásico.
      channelMessageId = telegramUser.enabled()
        ? await telegramUser.sendMessage(conversation.external_id, body)
        : await telegram.sendMessage(conversation.external_id, body);
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
      agent: req.agent || null,
    });

    res.json({ ok: true, message_id: messageId });
  } catch (err) {
    console.error(`[reply] error enviando por ${conversation.channel}:`, err.message);
    res.status(502).json({ error: `No se pudo enviar: ${err.message}` });
  }
});

/**
 * POST /api/conversations/:id/notes — notas internas (solo agentes).
 */
router.post('/conversations/:id/notes', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
  setConversationNotes(conversation.id, notes);
  res.json({ ok: true });
});

/**
 * POST /api/conversations/:id/archive — archivar o desarchivar.
 * Un mensaje nuevo del cliente desarchiva automáticamente.
 */
router.post('/conversations/:id/archive', (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });
  setConversationArchived(conversation.id, Boolean(req.body.archived));
  res.json({ ok: true });
});

/**
 * Respuestas rápidas (plantillas de los agentes).
 */
router.get('/quick-replies', (req, res) => {
  res.json(listQuickReplies());
});

router.post('/quick-replies', (req, res) => {
  const title = (req.body.title || '').trim();
  const body = (req.body.body || '').trim();
  if (!title || !body) return res.status(400).json({ error: 'Faltan título o texto' });
  const id = addQuickReply(title, body);
  res.json({ ok: true, id });
});

router.delete('/quick-replies/:id', (req, res) => {
  deleteQuickReply(req.params.id);
  res.json({ ok: true });
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
