import { useCallback, useEffect, useRef, useState } from 'react';

const CONVERSATIONS_POLL_MS = 4000;
const MESSAGES_POLL_MS = 3000;

function channelLabel(channel) {
  return channel === 'whatsapp' ? 'WhatsApp' : 'Telegram';
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) +
    ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatRemaining(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function WindowBadge({ win }) {
  if (!win) return null;
  if (win.open) {
    return (
      <span className="badge window-open" title="Se puede responder con texto libre">
        Ventana abierta · {formatRemaining(win.remaining_ms)}
      </span>
    );
  }
  return (
    <span className="badge window-closed" title="Fuera de la ventana de 24h: requiere plantilla aprobada">
      Ventana cerrada
    </span>
  );
}

function Avatar({ conv, size }) {
  if (conv.avatar_url) {
    return <img className={`avatar ${size || ''}`} src={conv.avatar_url} alt="" loading="lazy" />;
  }
  const initial = (conv.display_name || conv.external_id || '?').charAt(0).toUpperCase();
  return <div className={`avatar avatar-fallback ${conv.channel} ${size || ''}`}>{initial}</div>;
}

function AttendingBadge({ attending, me }) {
  if (!attending || attending.agent === me) return null;
  const min = Math.max(1, Math.round(attending.elapsed_ms / 60000));
  return (
    <span className="badge attending" title={`Última respuesta hace ${min} min`}>
      👤 {attending.agent} atendiendo
    </span>
  );
}

function ConversationItem({ conv, selected, onSelect, me }) {
  const snippet = conv.last_message_body
    ? (conv.last_message_direction === 'out' ? 'Tú: ' : '') + conv.last_message_body
    : 'Sin mensajes';
  const attendedByOther = conv.attending && conv.attending.agent !== me;
  return (
    <li
      className={`conv-item ${selected ? 'selected' : ''} ${conv.unread ? 'unread' : ''} ${attendedByOther ? 'attended-other' : ''}`}
      onClick={() => onSelect(conv.id)}
    >
      <Avatar conv={conv} />
      <div className="conv-content">
        <div className="conv-top">
          <span className={`channel-tag ${conv.channel}`}>{channelLabel(conv.channel)}</span>
          <span className="conv-time">{formatTime(conv.last_message_at)}</span>
        </div>
        <div className="conv-name">
          {conv.display_name || conv.external_id}
          {conv.unread ? <span className="unread-dot" /> : null}
        </div>
        <div className="conv-snippet">{snippet}</div>
        <AttendingBadge attending={conv.attending} me={me} />
        {conv.channel === 'whatsapp' && <WindowBadge win={conv.whatsapp_window} />}
      </div>
    </li>
  );
}

function MediaContent({ url }) {
  const ext = (url.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img className="bubble-media" src={url} alt="" loading="lazy" />
      </a>
    );
  }
  if (['ogg', 'oga', 'mp3', 'm4a', 'wav'].includes(ext)) {
    return <audio className="bubble-audio" controls src={url} preload="none" />;
  }
  if (['mp4', 'webm'].includes(ext)) {
    return <video className="bubble-media" controls src={url} preload="metadata" />;
  }
  return (
    <a className="bubble-file" href={url} target="_blank" rel="noreferrer" download>
      ⬇️ Descargar archivo
    </a>
  );
}

function MessageBubble({ msg }) {
  return (
    <div className={`bubble-row ${msg.direction === 'out' ? 'out' : 'in'}`}>
      <div className="bubble">
        {msg.media_url && <MediaContent url={msg.media_url} />}
        <div className="bubble-body">{msg.body}</div>
        <div className="bubble-meta">
          {formatTime(msg.created_at)}
          {msg.direction === 'out' && msg.agent ? ` · ${msg.agent}` : ''}
          {msg.direction === 'out' && msg.status ? ` · ${msg.status}` : ''}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState(null); // { conversation, messages }
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const lastCountRef = useRef(0);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) setConversations(await res.json());
    } catch {
      /* el siguiente poll lo reintenta */
    }
  }, []);

  const loadThread = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (res.ok) setThread(await res.json());
    } catch {
      /* el siguiente poll lo reintenta */
    }
  }, []);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMe(d.username))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadConversations();
    const t = setInterval(loadConversations, CONVERSATIONS_POLL_MS);
    return () => clearInterval(t);
  }, [loadConversations]);

  useEffect(() => {
    if (selectedId == null) return;
    loadThread(selectedId);
    const t = setInterval(() => loadThread(selectedId), MESSAGES_POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, loadThread]);

  // Autoscroll solo cuando llegan mensajes nuevos
  useEffect(() => {
    const count = thread?.messages?.length || 0;
    if (count !== lastCountRef.current) {
      lastCountRef.current = count;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [thread]);

  async function selectConversation(id) {
    setSelectedId(id);
    setThread(null);
    setError(null);
    lastCountRef.current = 0;
    fetch(`/api/conversations/${id}/read`, { method: 'POST' }).then(loadConversations);
  }

  async function sendReply(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending || selectedId == null) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`);
      } else {
        setDraft('');
        await loadThread(selectedId);
        await loadConversations();
      }
    } catch (err) {
      setError('No se pudo conectar con el servidor');
    } finally {
      setSending(false);
    }
  }

  const conv = thread?.conversation;
  const windowClosed =
    conv?.channel === 'whatsapp' && conv.whatsapp_window && !conv.whatsapp_window.open;
  const attendedByOther = conv?.attending && conv.attending.agent !== me;

  return (
    <div className={`app ${selectedId != null ? 'has-selection' : ''}`}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>Bandeja unificada</h1>
        </header>
        {conversations.length === 0 ? (
          <p className="empty-list">
            Sin conversaciones todavía. Cuando un cliente escriba al bot de Telegram
            o al número de WhatsApp, aparecerá aquí.
          </p>
        ) : (
          <ul className="conv-list">
            {conversations.map((c) => (
              <ConversationItem
                key={c.id}
                conv={c}
                selected={c.id === selectedId}
                onSelect={selectConversation}
                me={me}
              />
            ))}
          </ul>
        )}
      </aside>

      <main className="thread">
        {!conv ? (
          <div className="thread-empty">Selecciona una conversación</div>
        ) : (
          <>
            <header className="thread-header">
              <div className="thread-title">
                <button
                  className="back-btn"
                  onClick={() => { setSelectedId(null); setThread(null); }}
                  aria-label="Volver a la lista"
                >
                  ←
                </button>
                <Avatar conv={conv} size="small" />
                <div>
                  <div>
                    <span className={`channel-tag ${conv.channel}`}>{channelLabel(conv.channel)}</span>
                    <strong className="thread-name">{conv.display_name || conv.external_id}</strong>
                  </div>
                  {conv.username && <div className="thread-username">{conv.username}</div>}
                </div>
              </div>
              {conv.channel === 'whatsapp' && <WindowBadge win={conv.whatsapp_window} />}
            </header>

            <div className="messages">
              {thread.messages.map((m) => (
                <MessageBubble key={m.id} msg={m} />
              ))}
              <div ref={bottomRef} />
            </div>

            {attendedByOther && (
              <div className="attending-warning">
                👤 <strong>{conv.attending.agent}</strong> está atendiendo esta conversación
                (respondió hace {Math.max(1, Math.round(conv.attending.elapsed_ms / 60000))} min).
                Coordinaos antes de contestar.
              </div>
            )}
            {windowClosed && (
              <div className="window-warning">
                Ventana de 24h cerrada: WhatsApp solo permite plantillas aprobadas.
                El envío de texto libre fallará.
              </div>
            )}
            {error && <div className="send-error">{error}</div>}

            <form className="reply-box" onSubmit={sendReply}>
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribe una respuesta…"
                disabled={sending}
              />
              <button type="submit" disabled={sending || !draft.trim()}>
                {sending ? 'Enviando…' : 'Enviar'}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
