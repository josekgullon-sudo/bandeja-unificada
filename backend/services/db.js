const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'inbox.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
db.exec(schema);

function nowISO() {
  return new Date().toISOString();
}

/**
 * Localiza o crea la conversación de un contacto en un canal.
 * Actualiza display_name si llega uno nuevo no vacío.
 */
function findOrCreateConversation(channel, externalId, displayName) {
  const existing = db
    .prepare('SELECT * FROM conversations WHERE channel = ? AND external_id = ?')
    .get(channel, String(externalId));

  if (existing) {
    if (displayName && displayName !== existing.display_name) {
      db.prepare('UPDATE conversations SET display_name = ? WHERE id = ?').run(
        displayName,
        existing.id
      );
      existing.display_name = displayName;
    }
    return existing;
  }

  const result = db
    .prepare(
      `INSERT INTO conversations (channel, external_id, display_name, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(channel, String(externalId), displayName || null, nowISO());

  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * Guarda un mensaje entrante del cliente y actualiza los timestamps de la
 * conversación, incluido last_customer_message_at (ventana de 24h de WhatsApp).
 * Devuelve null si el mensaje ya existía (deduplicación por channel_message_id).
 */
function saveIncomingMessage(conversationId, { body, mediaUrl, channelMessageId }) {
  if (channelMessageId) {
    const dup = db
      .prepare(
        `SELECT id FROM messages
         WHERE conversation_id = ? AND channel_message_id = ? AND direction = 'in'`
      )
      .get(conversationId, String(channelMessageId));
    if (dup) return null;
  }

  const ts = nowISO();
  const result = db
    .prepare(
      `INSERT INTO messages (conversation_id, direction, body, media_url, channel_message_id, created_at)
       VALUES (?, 'in', ?, ?, ?, ?)`
    )
    .run(conversationId, body || null, mediaUrl || null, channelMessageId ? String(channelMessageId) : null, ts);

  db.prepare(
    `UPDATE conversations
     SET last_message_at = ?, last_customer_message_at = ?, unread = 1
     WHERE id = ?`
  ).run(ts, ts, conversationId);

  return result.lastInsertRowid;
}

/**
 * Guarda un mensaje saliente (respuesta de un agente) y actualiza last_message_at.
 */
function saveOutgoingMessage(conversationId, { body, channelMessageId, status }) {
  const ts = nowISO();
  const result = db
    .prepare(
      `INSERT INTO messages (conversation_id, direction, body, channel_message_id, status, created_at)
       VALUES (?, 'out', ?, ?, ?, ?)`
    )
    .run(conversationId, body, channelMessageId ? String(channelMessageId) : null, status || 'sent', ts);

  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(ts, conversationId);

  return result.lastInsertRowid;
}

/**
 * ¿Existe ya un mensaje (en cualquier dirección) con este id de canal en la
 * conversación? Evita duplicados cuando la propia bandeja envía y luego
 * recibe el eco del mensaje por la sesión de cuenta personal.
 */
function hasMessage(conversationId, channelMessageId) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM messages WHERE conversation_id = ? AND channel_message_id = ?')
      .get(conversationId, String(channelMessageId))
  );
}

function updateMessageStatusByChannelId(channelMessageId, status) {
  db.prepare(
    `UPDATE messages SET status = ? WHERE channel_message_id = ? AND direction = 'out'`
  ).run(status, String(channelMessageId));
}

function listConversations() {
  return db
    .prepare(
      `SELECT c.*,
              (SELECT body FROM messages m
               WHERE m.conversation_id = c.id
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_body,
              (SELECT direction FROM messages m
               WHERE m.conversation_id = c.id
               ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_direction
       FROM conversations c
       ORDER BY c.last_message_at DESC`
    )
    .all();
}

function getConversation(id) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

function listMessages(conversationId) {
  return db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`
    )
    .all(conversationId);
}

function markConversationRead(id) {
  db.prepare('UPDATE conversations SET unread = 0 WHERE id = ?').run(id);
}

module.exports = {
  db,
  findOrCreateConversation,
  saveIncomingMessage,
  saveOutgoingMessage,
  hasMessage,
  updateMessageStatusByChannelId,
  listConversations,
  getConversation,
  listMessages,
  markConversationRead,
};
