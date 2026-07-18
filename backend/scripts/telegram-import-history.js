/**
 * Importa el historial de chats privados de la cuenta personal de Telegram
 * a la bandeja: conversaciones, mensajes con su fecha original, nombre,
 * @username y foto de perfil.
 *
 * Uso:  node scripts/telegram-import-history.js
 *
 * Configurable por variables de entorno (opcionales):
 *   IMPORT_DIALOGS=30    cuántos chats recientes importar
 *   IMPORT_MESSAGES=100  cuántos mensajes por chat
 *
 * Es idempotente: si se ejecuta dos veces no duplica nada. Los adjuntos del
 * historial no se descargan (solo se indican como "📷 Foto", etc.) para no
 * saturar el disco; los adjuntos de mensajes NUEVOS sí se descargan siempre.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const {
  findOrCreateConversation,
  importMessage,
  recalcConversationTimestamps,
} = require('../services/db');
const { describeMedia, displayNameOf, refreshProfile } = require('../services/telegram-user');

const DIALOGS = parseInt(process.env.IMPORT_DIALOGS || '30', 10);
const MESSAGES = parseInt(process.env.IMPORT_MESSAGES || '100', 10);

async function main() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionStr = process.env.TELEGRAM_SESSION;

  if (!apiId || !apiHash || !sessionStr) {
    console.error('Faltan TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION en el .env.');
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();

  if (!(await client.isUserAuthorized())) {
    console.error('La sesión no está autorizada. Ejecuta antes: node scripts/telegram-login.js');
    process.exit(1);
  }

  console.log(`Importando los últimos ${DIALOGS} chats privados (${MESSAGES} mensajes por chat)...\n`);

  const dialogs = await client.getDialogs({ limit: DIALOGS * 3 });
  let imported = 0;

  for (const dialog of dialogs) {
    if (imported >= DIALOGS) break;
    if (!dialog.isUser) continue; // solo chats persona a persona

    const peer = dialog.entity;
    if (!peer || peer.bot || peer.self) continue;
    if (String(peer.id) === '777000') continue; // avisos de Telegram

    const peerId = peer.id.toString();
    const conversation = findOrCreateConversation('telegram', peerId, displayNameOf(peer));
    await refreshProfile(client, conversation, peer);

    const messages = await client.getMessages(peer, { limit: MESSAGES });
    let added = 0;
    for (const msg of messages.reverse()) {
      if (!msg || (!msg.message && !msg.media)) continue;
      const ok = importMessage(conversation.id, {
        direction: msg.out ? 'out' : 'in',
        body: msg.message || describeMedia(msg),
        channelMessageId: msg.id,
        createdAt: new Date(msg.date * 1000).toISOString(),
        status: msg.out ? 'sent' : null,
      });
      if (ok) added++;
    }
    recalcConversationTimestamps(conversation.id);

    imported++;
    console.log(`✔ ${displayNameOf(peer) || peerId} — ${added} mensajes nuevos importados`);
  }

  console.log(`\nHecho: ${imported} chats procesados. Recarga la bandeja para verlos.`);
  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fallo en la importación:', err);
  process.exit(1);
});
