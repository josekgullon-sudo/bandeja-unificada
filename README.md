# Bandeja unificada — WhatsApp Business + Telegram

Herramienta interna de atención al cliente: recibe mensajes de WhatsApp
(Cloud API de Meta) y de Telegram en una misma bandeja y permite responder a
ambos canales desde una única interfaz web. **100% manual**: sin bots ni
respuestas automáticas; solo se envía cuando una persona pulsa enviar.

## Stack

- **Backend:** Node.js + Express (puerto 3000 por defecto)
- **Base de datos:** SQLite (`backend/db/inbox.db`, se crea sola al arrancar)
- **Frontend:** React + Vite (en producción lo sirve el propio Express desde `frontend/dist`)
- **Telegram:** dos modos —
  - **Cuenta personal (recomendado):** la bandeja se conecta vía MTProto
    (GramJS) como un dispositivo más de la cuenta del dueño y recibe sus
    chats privados. Los clientes escriben al número/usuario de siempre.
  - **Bot:** long polling con la Bot API; los clientes escriben al bot.
- **WhatsApp:** webhook `GET/POST /webhook` + envío por Graph API
- **Despliegue:** PM2 + Nginx + Let's Encrypt en VPS

## Telegram en modo cuenta personal

1. Entrar en <https://my.telegram.org> con el número de la cuenta → **API
   development tools** → crear una app → copiar `api_id` y `api_hash`.
2. Ponerlos en `backend/.env` como `TELEGRAM_API_ID` y `TELEGRAM_API_HASH`.
3. Autorizar la sesión (una única vez): `node scripts/telegram-login.js`
   dentro de `backend/`. Pide teléfono, código (llega a la app de Telegram)
   y contraseña 2FA si existe. Imprime el valor de `TELEGRAM_SESSION` para
   pegar en el `.env`.
4. Reiniciar: `pm2 restart inbox`.

La sesión aparece en Telegram → Ajustes → Dispositivos y puede revocarse
desde ahí en cualquier momento (habría que repetir el paso 3).

⚠️ Con este modo, quien tenga acceso a la bandeja (o al `.env`) puede leer y
escribir como la cuenta de Telegram. Definir SIEMPRE `INBOX_USER`/`INBOX_PASS`
y servir bajo HTTPS.

## Puesta en marcha (local o VPS)

Requiere Node 18 o superior.

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env    # y rellena TELEGRAM_BOT_TOKEN (mínimo)

# 2. Frontend (build de producción)
cd ../frontend
npm install
npm run build

# 3. Arrancar
cd ../backend
npm start
# → http://localhost:3000
```

Para desarrollo con recarga en caliente del frontend: `npm run dev` dentro de
`frontend/` (levanta Vite en :5173 con proxy de `/api` hacia :3000).

### Validar el token de Telegram

```bash
curl "https://api.telegram.org/bot<TU_TOKEN>/getMe"
```

Debe devolver `"ok":true` con los datos del bot. Después arranca el backend,
escribe al bot desde tu Telegram personal y el mensaje aparecerá en la bandeja.

## Variables de entorno (`backend/.env`)

| Variable | Descripción |
|---|---|
| `INBOX_USER` / `INBOX_PASS` | Usuario y contraseña de acceso a la bandeja (obligatorio si está expuesta) |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | Credenciales de my.telegram.org (modo cuenta personal) |
| `TELEGRAM_SESSION` | Sesión autorizada, generada con `scripts/telegram-login.js` |
| `TELEGRAM_BOT_TOKEN` | Token del bot de @BotFather (solo modo bot) |
| `WHATSAPP_TOKEN` | Token permanente de sistema de la app de Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID del número de la Cloud API |
| `WHATSAPP_VERIFY_TOKEN` | Cadena secreta propia para verificar el webhook |
| `PORT` | Puerto del backend (3000 por defecto) |

`.env` está en `.gitignore` y **nunca** debe subirse a git.

## Endpoints

| Método y ruta | Uso |
|---|---|
| `GET /webhook` | Verificación del webhook de Meta (hub.challenge) |
| `POST /webhook` | Mensajes entrantes y estados de WhatsApp |
| `POST /telegram/webhook` | Updates de Telegram (solo si se usa webhook en vez de polling) |
| `GET /api/conversations` | Lista de conversaciones con ventana de 24h calculada |
| `GET /api/conversations/:id/messages` | Historial de un hilo |
| `POST /api/conversations/:id/reply` | Enviar respuesta (enruta según canal) |
| `POST /api/conversations/:id/read` | Marcar como leída |
| `GET /health` | Comprobación de vida |

## Ventana de 24h (WhatsApp)

Cada mensaje entrante del cliente actualiza `last_customer_message_at`. Si han
pasado más de 24 h desde entonces, WhatsApp rechaza el texto libre: el backend
devuelve `409` sin intentar el envío y la interfaz muestra "Ventana cerrada,
requiere plantilla aprobada". Las conversaciones de WhatsApp muestran un
indicador verde (abierta, con tiempo restante) o gris (cerrada).

## Despliegue en el VPS (Hostinger)

```bash
# Clonar y construir
git clone <repo> /opt/inbox && cd /opt/inbox
cd backend && npm install --omit=dev && cp .env.example .env && nano .env
cd ../frontend && npm install && npm run build

# PM2
cd /opt/inbox
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

### Nginx + Let's Encrypt (necesario para el webhook de WhatsApp)

Crear un subdominio (p. ej. `inbox.tudominio.com`) apuntando al VPS y:

```nginx
server {
    server_name inbox.tudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo certbot --nginx -d inbox.tudominio.com
```

La URL del webhook para Meta será `https://inbox.tudominio.com/webhook`.

> Nota: la bandeja no tiene autenticación propia en la v1. Hasta añadirla,
> protege la ruta `/` en Nginx con `auth_basic` (htpasswd) dejando libres
> `/webhook` y `/telegram/webhook`, o restringe por IP.

## Estructura

```
/backend
  server.js
  /routes      webhook-whatsapp.js · webhook-telegram.js · api.js
  /services    whatsapp.js · telegram.js · db.js
  /db          schema.sql (inbox.db se genera aquí)
  .env         (no se commitea)
/frontend      app React (Vite)
ecosystem.config.js
```
