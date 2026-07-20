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

function isPending(conv) {
  return conv.last_message_direction === 'in';
}

/** Pitido corto para avisar de mensaje nuevo (sin ficheros de audio). */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    /* sin audio disponible */
  }
}

function PendingBadge({ conv }) {
  if (!isPending(conv)) return null;
  const min = Math.floor((Date.now() - Date.parse(conv.last_message_at)) / 60000);
  const label = min < 1 ? 'ahora' : min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
  return (
    <span className="badge pending" title="El último mensaje es del cliente y nadie ha respondido">
      ⏳ Sin responder · {label}
    </span>
  );
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
        <PendingBadge conv={conv} />
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

function Login({ onLogin }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.trim(), password: pass }),
      });
      if (r.ok) {
        const d = await r.json();
        onLogin(d.username);
      } else {
        setErr('Usuario o contraseña incorrectos');
      }
    } catch {
      setErr('No se pudo conectar con el servidor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">💬</div>
        <h1>Bandeja unificada</h1>
        <p className="login-sub">Atención al cliente · Telegram & WhatsApp</p>
        <input
          placeholder="Usuario"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
        {err && <div className="login-error">{err}</div>}
        <button type="submit" disabled={busy || !user.trim() || !pass}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [authState, setAuthState] = useState('loading'); // loading | anon | in
  const [me, setMe] = useState(null);
  const [filter, setFilter] = useState('all'); // all | pending | unread | archived
  const [search, setSearch] = useState('');
  const [notifOn, setNotifOn] = useState(() => localStorage.getItem('notifOn') === '1');
  const [quickReplies, setQuickReplies] = useState([]);
  const [showQR, setShowQR] = useState(false);
  const [qrTitle, setQrTitle] = useState('');
  const [qrBody, setQrBody] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState(null); // { conversation, messages }
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const lastCountRef = useRef(0);
  const lastIncomingRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) setConversations(await res.json());
      else if (res.status === 401) setAuthState('anon'); // sesión caducada
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
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setMe(d.username);
        setAuthState('in');
      })
      .catch(() => setAuthState('anon'));
  }, []);

  const loadQuickReplies = useCallback(async () => {
    try {
      const r = await fetch('/api/quick-replies');
      if (r.ok) setQuickReplies(await r.json());
    } catch {
      /* reintento en la próxima apertura del panel */
    }
  }, []);

  useEffect(() => {
    loadQuickReplies();
  }, [loadQuickReplies]);

  // Aviso sonoro + notificación del navegador al entrar un mensaje nuevo
  useEffect(() => {
    const latest = conversations
      .filter((c) => c.last_message_direction === 'in')
      .reduce((max, c) => Math.max(max, Date.parse(c.last_message_at) || 0), 0);
    if (lastIncomingRef.current === null) {
      lastIncomingRef.current = latest;
      return;
    }
    if (latest > lastIncomingRef.current) {
      lastIncomingRef.current = latest;
      if (notifOn) {
        beep();
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
          new Notification('Bandeja unificada', { body: 'Nuevo mensaje de un cliente' });
        }
      }
    }
  }, [conversations, notifOn]);

  function toggleNotif() {
    const next = !notifOn;
    setNotifOn(next);
    localStorage.setItem('notifOn', next ? '1' : '0');
    if (next) {
      beep(); // el clic habilita el audio en el navegador
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }

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
    setNotesOpen(false);
    setShowQR(false);
    lastCountRef.current = 0;
    fetch(`/api/conversations/${id}/read`, { method: 'POST' }).then(loadConversations);
  }

  async function toggleArchive() {
    if (!conv) return;
    await fetch(`/api/conversations/${conv.id}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: !conv.archived }),
    });
    if (!conv.archived) {
      setSelectedId(null);
      setThread(null);
    } else {
      loadThread(conv.id);
    }
    loadConversations();
  }

  async function saveNotes() {
    if (!conv) return;
    await fetch(`/api/conversations/${conv.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesDraft }),
    });
    setNotesOpen(false);
    loadThread(conv.id);
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

  const activeConvs = conversations.filter((c) => !c.archived);
  const pendingCount = activeConvs.filter(isPending).length;
  const unreadCount = activeConvs.filter((c) => c.unread).length;
  const archivedCount = conversations.length - activeConvs.length;

  // Contador de pendientes en el título de la pestaña del navegador
  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) Bandeja unificada` : 'Bandeja unificada';
  }, [pendingCount]);

  const visibleConversations = conversations
    .filter((c) => {
      if (filter === 'archived') return c.archived;
      if (c.archived) return false;
      if (filter === 'pending') return isPending(c);
      if (filter === 'unread') return c.unread;
      return true;
    })
    .filter((c) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [c.display_name, c.username, c.external_id, c.last_message_body].some(
        (v) => v && v.toLowerCase().includes(q)
      );
    });

  const conv = thread?.conversation;
  const windowClosed =
    conv?.channel === 'whatsapp' && conv.whatsapp_window && !conv.whatsapp_window.open;
  const attendedByOther = conv?.attending && conv.attending.agent !== me;

  if (authState === 'loading') {
    return <div className="login-screen" />;
  }
  if (authState === 'anon') {
    return (
      <Login
        onLogin={(username) => {
          setMe(username);
          setAuthState('in');
        }}
      />
    );
  }

  return (
    <div className={`app ${selectedId != null ? 'has-selection' : ''}`}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="sidebar-top">
            <h1>Bandeja unificada</h1>
            <div className="sidebar-top-actions">
              <button
                className={`icon-btn bell ${notifOn ? 'on' : ''}`}
                title={notifOn ? 'Notificaciones activadas' : 'Activar sonido y notificaciones'}
                onClick={toggleNotif}
              >
                {notifOn ? '🔔' : '🔕'}
              </button>
              <button
                className="icon-btn"
                title={me ? `Cerrar sesión (${me})` : 'Cerrar sesión'}
                onClick={async () => {
                  await fetch('/api/logout', { method: 'POST' });
                  window.location.reload();
                }}
              >
                🚪
              </button>
            </div>
          </div>
          {me && <div className="sidebar-me">Conectado como {me}</div>}
          <input
            className="search-input"
            type="search"
            placeholder="Buscar cliente…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <nav className="filter-tabs">
            <button
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              Todos
            </button>
            <button
              className={`${filter === 'pending' ? 'active' : ''} ${pendingCount ? 'has-pending' : ''}`}
              onClick={() => setFilter('pending')}
            >
              Sin responder{pendingCount ? ` (${pendingCount})` : ''}
            </button>
            <button
              className={filter === 'unread' ? 'active' : ''}
              onClick={() => setFilter('unread')}
            >
              No leídos{unreadCount ? ` (${unreadCount})` : ''}
            </button>
            <button
              className={filter === 'archived' ? 'active' : ''}
              onClick={() => setFilter('archived')}
            >
              🗄️{archivedCount ? ` ${archivedCount}` : ''}
            </button>
          </nav>
        </header>
        {visibleConversations.length === 0 ? (
          <p className="empty-list">
            {conversations.length === 0
              ? 'Sin conversaciones todavía. Cuando un cliente escriba, aparecerá aquí.'
              : filter === 'pending'
                ? '🎉 Todo respondido. Nadie espera contestación.'
                : 'Nada que mostrar con este filtro.'}
          </p>
        ) : (
          <ul className="conv-list">
            {visibleConversations.map((c) => (
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
              <div className="thread-actions">
                {conv.channel === 'whatsapp' && <WindowBadge win={conv.whatsapp_window} />}
                <button
                  className={`icon-btn ${conv.notes ? 'has-notes' : ''}`}
                  title={conv.notes ? 'Ver notas internas' : 'Añadir notas internas'}
                  onClick={() => {
                    setNotesDraft(conv.notes || '');
                    setNotesOpen((o) => !o);
                  }}
                >
                  📝
                </button>
                <button
                  className="icon-btn"
                  title={conv.archived ? 'Desarchivar' : 'Archivar conversación'}
                  onClick={toggleArchive}
                >
                  {conv.archived ? '📤' : '🗄️'}
                </button>
              </div>
            </header>

            {notesOpen && (
              <div className="notes-panel">
                <textarea
                  rows={3}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Notas internas sobre este cliente (el cliente nunca las ve)…"
                />
                <button onClick={saveNotes}>Guardar</button>
              </div>
            )}

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

            {showQR && (
              <div className="qr-panel">
                {quickReplies.length === 0 && (
                  <p className="qr-empty">Sin plantillas todavía. Crea la primera abajo.</p>
                )}
                <ul>
                  {quickReplies.map((q) => (
                    <li key={q.id}>
                      <button
                        type="button"
                        className="qr-use"
                        onClick={() => {
                          setDraft((d) => (d ? `${d} ${q.body}` : q.body));
                          setShowQR(false);
                        }}
                      >
                        <strong>{q.title}</strong>
                        <span>{q.body}</span>
                      </button>
                      <button
                        type="button"
                        className="qr-del"
                        title="Eliminar plantilla"
                        onClick={async () => {
                          await fetch(`/api/quick-replies/${q.id}`, { method: 'DELETE' });
                          loadQuickReplies();
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  className="qr-add"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!qrTitle.trim() || !qrBody.trim()) return;
                    await fetch('/api/quick-replies', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ title: qrTitle, body: qrBody }),
                    });
                    setQrTitle('');
                    setQrBody('');
                    loadQuickReplies();
                  }}
                >
                  <input
                    placeholder="Título (ej. Pago)"
                    value={qrTitle}
                    onChange={(e) => setQrTitle(e.target.value)}
                  />
                  <input
                    placeholder="Texto de la respuesta…"
                    value={qrBody}
                    onChange={(e) => setQrBody(e.target.value)}
                  />
                  <button type="submit">Añadir</button>
                </form>
              </div>
            )}

            <form className="reply-box" onSubmit={sendReply}>
              <button
                type="button"
                className={`icon-btn qr-toggle ${showQR ? 'on' : ''}`}
                title="Respuestas rápidas"
                onClick={() => setShowQR((s) => !s)}
              >
                ⚡
              </button>
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
