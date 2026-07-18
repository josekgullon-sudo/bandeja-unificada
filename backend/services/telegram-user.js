/**
 * Conexión a Telegram como CUENTA PERSONAL (API de cliente / MTProto vía
 * GramJS). La bandeja actúa como un dispositivo más de la cuenta, igual que
 * Telegram Desktop: recibe los chats privados del dueño y responde en su
 * nombre cuando un agente pulsa enviar.
 *
 * Requiere en .env: TELEGRAM_API_ID, TELEGRAM_API_HASH y TELEGRAM_SESSION
 * (esta última se genera una única vez con scripts/telegram-login.js).
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const {
  findOrCreateConversation,
  saveIncomingMessage,
  saveOutgoingMessage,
  hasMessage,
} = require('./db');

let client = null;

function enabled() {
  return Boolean(
    process.env.TELEGRAM_API_ID &&
    process.env.TELEGRAM_API_HASH &&
    process.env.TELEGRAM_SESSION
  );
}

function describeMedia(message) {
  if (message.photo) return '📷 Foto' + (message.message ? `: ${message.message}` : '');
  if (message.voice) return '🎤 Nota de voz';
  if (message.audio) return '🎵 Audio';
  if (message.video) return '🎬 Vídeo' + (message.message ? `: ${message.message}` : '');
  if (message.document) return '📎 Archivo';
  if (message.sticker) return 'Sticker';
  if (message.geo) return '📍 Ubicación';
  if (message.contact) return '👤 Contacto compartido';
  return '[Mensaje no soportado]';
}

function displayNameOf(user) {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return name || (user.username ? `@${user.username}` : null);
}

async function onNewMessage(event) {
  try {
    // Solo chats privados (persona a persona). Grupos y canales, fuera.
    if (!event.isPrivate) return;
    const message = event.message;
    if (!message) return;

    // En un chat privado, chatId es el id del interlocutor tanto para
    // mensajes entrantes como salientes.
    const peerId = message.chatId ? message.chatId.toString() : null;
    if (!peerId) return;

    const peer = await message.getChat().catch(() => null);

    // Ignorar bots y el usuario de servicio de Telegram (777000): son
    // notificaciones, no clientes.
    if (peer && peer.bot) return;
    if (peerId === '777000') return;

    const body = message.message || describeMedia(message);
    const conversation = findOrCreateConversation('telegram', peerId, displayNameOf(peer));

    if (message.out) {
      // Mensaje enviado por el dueño desde otro dispositivo (su móvil, su
      // Telegram Desktop...). Lo registramos para que la bandeja refleje la
      // conversación completa. Si lo envió la propia bandeja ya está
      // guardado: se detecta por channel_message_id y se omite.
      if (hasMessage(conversation.id, message.id)) return;
      saveOutgoingMessage(conversation.id, {
        body,
        channelMessageId: message.id,
        status: 'sent',
      });
    } else {
      saveIncomingMessage(conversation.id, {
        body,
        channelMessageId: message.id,
      });
    }
  } catch (err) {
    console.error('[telegram-user] error procesando mensaje:', err);
  }
}

async function start() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const session = new StringSession(process.env.TELEGRAM_SESSION);

  client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 1000000,
    autoReconnect: true,
  });

  await client.connect();

  if (!(await client.isUserAuthorized())) {
    console.error(
      '[telegram-user] la sesión no está autorizada. Regenera TELEGRAM_SESSION ' +
      'con: node scripts/telegram-login.js'
    );
    return;
  }

  const me = await client.getMe();
  client.addEventHandler(onNewMessage, new NewMessage({}));
  console.log(
    `[telegram-user] conectado como ${displayNameOf(me) || me.id} — ` +
    'los chats privados de la cuenta llegan a la bandeja'
  );
}

/**
 * Envía un mensaje de texto a un usuario en nombre de la cuenta personal.
 * Devuelve el id del mensaje.
 */
async function sendMessage(userId, text) {
  if (!client) throw new Error('Cliente de Telegram no iniciado');
  const entity = await client.getInputEntity(Number(userId));
  const result = await client.sendMessage(entity, { message: text });
  return String(result.id);
}

module.exports = { enabled, start, sendMessage };
