const {
  findOrCreateConversation,
  saveIncomingMessage,
} = require('./db');

const API_BASE = 'https://api.telegram.org';

function botUrl(method) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN no está definido en .env');
  return `${API_BASE}/bot${token}/${method}`;
}

async function callTelegram(method, payload) {
  const res = await fetch(botUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(`Telegram ${method}: ${data.description || 'error desconocido'}`);
    err.telegram = data;
    throw err;
  }
  return data.result;
}

/**
 * Envía un mensaje de texto a un chat de Telegram.
 * Devuelve el message_id asignado por Telegram.
 */
async function sendMessage(chatId, text) {
  const result = await callTelegram('sendMessage', { chat_id: chatId, text });
  return String(result.message_id);
}

/**
 * Describe un mensaje no textual para mostrar algo legible en la bandeja (v1
 * sin descarga de adjuntos).
 */
function describeNonText(msg) {
  if (msg.photo) return '📷 Foto' + (msg.caption ? `: ${msg.caption}` : '');
  if (msg.voice) return '🎤 Nota de voz';
  if (msg.audio) return '🎵 Audio';
  if (msg.video) return '🎬 Vídeo' + (msg.caption ? `: ${msg.caption}` : '');
  if (msg.document) return `📎 Archivo: ${msg.document.file_name || 'documento'}`;
  if (msg.sticker) return `Sticker ${msg.sticker.emoji || ''}`.trim();
  if (msg.location) return '📍 Ubicación';
  if (msg.contact) return `👤 Contacto: ${msg.contact.first_name || ''} ${msg.contact.phone_number || ''}`.trim();
  return '[Mensaje no soportado]';
}

/**
 * Procesa un update de Telegram (viene del long polling o del webhook).
 * Solo nos interesan mensajes entrantes de chats privados: los clientes
 * escriben al bot en privado.
 */
function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.chat) return;
  if (msg.chat.type !== 'private') return;
  if (msg.from && msg.from.is_bot) return;

  const displayName =
    [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') ||
    (msg.chat.username ? `@${msg.chat.username}` : null);

  const conversation = findOrCreateConversation('telegram', msg.chat.id, displayName);

  const body = msg.text != null ? msg.text : describeNonText(msg);

  saveIncomingMessage(conversation.id, {
    body,
    channelMessageId: msg.message_id,
  });
}

/**
 * Bucle de long polling contra getUpdates. Alternativa al webhook: no
 * requiere HTTPS ni URL pública, ideal para arrancar.
 */
function startPolling() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN vacío: polling desactivado');
    return;
  }

  let offset = 0;
  let stopped = false;

  async function loop() {
    // Si en algún momento se configuró un webhook, hay que quitarlo o
    // getUpdates devuelve error 409.
    try {
      await callTelegram('deleteWebhook', {});
    } catch (err) {
      console.warn('[telegram] deleteWebhook falló (continuando):', err.message);
    }

    console.log('[telegram] long polling iniciado');

    while (!stopped) {
      try {
        const updates = await callTelegram('getUpdates', {
          offset,
          timeout: 30,
          allowed_updates: ['message'],
        });
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            handleUpdate(update);
          } catch (err) {
            console.error('[telegram] error procesando update:', err);
          }
        }
      } catch (err) {
        console.error('[telegram] error en getUpdates, reintento en 5s:', err.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  loop();

  return () => {
    stopped = true;
  };
}

module.exports = { sendMessage, handleUpdate, startPolling };
