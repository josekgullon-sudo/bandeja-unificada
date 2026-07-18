const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';

/**
 * Ventana de servicio de WhatsApp: 24 horas desde el último mensaje del
 * cliente. Fuera de ella solo se pueden enviar plantillas aprobadas.
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

function windowInfo(lastCustomerMessageAt) {
  if (!lastCustomerMessageAt) {
    return { open: false, expires_at: null, remaining_ms: 0 };
  }
  const expiresAt = new Date(lastCustomerMessageAt).getTime() + WINDOW_MS;
  const remaining = expiresAt - Date.now();
  return {
    open: remaining > 0,
    expires_at: new Date(expiresAt).toISOString(),
    remaining_ms: Math.max(0, remaining),
  };
}

/**
 * Envía un mensaje de texto libre por la Cloud API.
 * Devuelve el id de mensaje de WhatsApp (wamid...).
 */
async function sendText(toPhone, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error('WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID no están definidos en .env');
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok || data.error) {
    const detail = data.error ? `${data.error.message} (code ${data.error.code})` : res.statusText;
    const err = new Error(`WhatsApp API: ${detail}`);
    err.whatsapp = data.error || null;
    throw err;
  }

  return data.messages && data.messages[0] ? data.messages[0].id : null;
}

module.exports = { sendText, windowInfo, WINDOW_MS };
