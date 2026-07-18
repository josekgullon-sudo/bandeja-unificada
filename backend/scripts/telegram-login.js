/**
 * Autorización única de la cuenta personal de Telegram.
 *
 * Uso:  node scripts/telegram-login.js
 *
 * Pide teléfono, código (llega a la app de Telegram) y contraseña de
 * verificación en dos pasos si la hay. Al terminar imprime el valor de
 * TELEGRAM_SESSION para pegar en el .env. Es como vincular un dispositivo
 * nuevo: aparecerá en Telegram → Ajustes → Dispositivos, y desde ahí se
 * puede cerrar la sesión si algún día hace falta revocarla.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const readline = require('readline/promises');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const ENV_PATH = path.join(__dirname, '..', '.env');

/** Escribe TELEGRAM_SESSION en el .env, sustituyendo cualquier línea previa. */
function saveSessionToEnv(sessionStr) {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    /* si no existe .env se crea */
  }
  const lines = content
    .split('\n')
    .filter((line) => !line.startsWith('TELEGRAM_SESSION='));
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push(`TELEGRAM_SESSION=${sessionStr}`, '');
  fs.writeFileSync(ENV_PATH, lines.join('\n'));
}

async function main() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId || !apiHash) {
    console.error(
      'Faltan TELEGRAM_API_ID y/o TELEGRAM_API_HASH en el .env.\n' +
      'Se obtienen en https://my.telegram.org → API development tools.'
    );
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: () => rl.question('Número de teléfono (con prefijo, ej. +34600111222): '),
    password: () => rl.question('Contraseña de verificación en dos pasos (Enter si no tienes): '),
    phoneCode: () => rl.question('Código que te ha llegado a Telegram: '),
    onError: (err) => console.error('Error:', err.message),
  });

  saveSessionToEnv(client.session.save());
  console.log('\n✔ Sesión autorizada y guardada automáticamente en el .env.');
  console.log('Solo queda reiniciar: pm2 restart inbox');

  await client.disconnect();
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fallo en la autorización:', err);
  process.exit(1);
});
