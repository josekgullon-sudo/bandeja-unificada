/**
 * Conexión a Telegram como CUENTA PERSONAL (API de cliente / MTProto vía
 * GramJS). La bandeja actúa como un dispositivo más de la cuenta, igual que
 * Telegram Desktop: recibe los chats privados del dueño y responde en su
 * nombre cuando un agente pulsa enviar.
 *
 * Requiere en .env: TELEGRAM_API_ID, TELEGRAM_API_HASH y TELEGRAM_SESSION
 * (esta última se genera una única vez con scripts/telegram-login.js).
 */
const fs = require('fs');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const {
  findOrCreateConversation,
  saveIncomingMessage,
  saveOutgoingMessage,
  hasMessage,
  updateConversationProfile,
} = require('./db');

let client = null;

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // adjuntos mayores no se descargan

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
};

function originalFileName(message) {
  const attrs = (message.document && message.document.attributes) || [];
  const withName = attrs.find((a) => a.fileName);
  return withName ? withName.fileName : null;
}

function pickExtension(message) {
  if (message.photo) return '.jpg';
  const original = originalFileName(message);
  if (original && path.extname(original)) return path.extname(original);
  const mime = message.document && message.document.mimeType;
  return (mime && EXT_BY_MIME[mime]) || '.bin';
}

/**
 * Descarga el adjunto de un mensaje a backend/uploads y devuelve la ruta
 * pública (/media/...) o null si no hay adjunto, es demasiado grande o falla.
 */
async function downloadMediaOf(message) {
  try {
    if (!message.media) return null;
    if (message.document && Number(message.document.size) > MAX_MEDIA_BYTES) {
      return null;
    }
    const buffer = await client.downloadMedia(message);
    if (!buffer || !buffer.length) return null;

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = `tg_${message.chatId}_${message.id}${pickExtension(message)}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
    return `/media/${name}`;
  } catch (err) {
    console.error('[telegram-user] no se pudo descargar adjunto:', err.message);
    return null;
  }
}

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
  if (message.sticker) return 'Sticker';
  if (message.audio) return '🎵 Audio';
  if (message.video) return '🎬 Vídeo' + (message.message ? `: ${message.message}` : '');
  if (message.document) {
    const name = originalFileName(message);
    return '📎 ' + (name || 'Archivo');
  }
  if (message.geo) return '📍 Ubicación';
  if (message.contact) return '👤 Contacto compartido';
  return '[Mensaje no soportado]';
}

function displayNameOf(user) {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return name || (user.username ? `@${user.username}` : null);
}

/**
 * Descarga la foto de perfil del contacto (si no la tenemos aún) y guarda
 * su @username. No bloquea el guardado del mensaje.
 */
async function refreshProfile(clientRef, conversation, peer) {
  try {
    if (!peer) return;
    const username = peer.username ? `@${peer.username}` : null;
    if (username !== (conversation.username || null)) {
      updateConversationProfile(conversation.id, { username });
    }
    if (!conversation.avatar_url && peer.photo) {
      const buffer = await clientRef.downloadProfilePhoto(peer, { isBig: false });
      if (buffer && buffer.length) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        const name = `avatar_tg_${conversation.external_id}.jpg`;
        fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
        updateConversationProfile(conversation.id, { avatarUrl: `/media/${name}` });
      }
    }
  } catch (err) {
    console.error('[telegram-user] no se pudo actualizar perfil:', err.message);
  }
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
    refreshProfile(client, conversation, peer); // en segundo plano, no bloquea

    if (message.out) {
      // Mensaje enviado por el dueño desde otro dispositivo (su móvil, su
      // Telegram Desktop...). Lo registramos para que la bandeja refleje la
      // conversación completa. Si lo envió la propia bandeja ya está
      // guardado: se detecta por channel_message_id y se omite.
      if (hasMessage(conversation.id, message.id)) return;
      const mediaUrl = await downloadMediaOf(message);
      saveOutgoingMessage(conversation.id, {
        body,
        mediaUrl,
        channelMessageId: message.id,
        status: 'sent',
      });
    } else {
      const mediaUrl = await downloadMediaOf(message);
      saveIncomingMessage(conversation.id, {
        body,
        mediaUrl,
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

module.exports = {
  enabled,
  start,
  sendMessage,
  // helpers reutilizados por scripts/telegram-import-history.js
  describeMedia,
  displayNameOf,
  refreshProfile,
};
