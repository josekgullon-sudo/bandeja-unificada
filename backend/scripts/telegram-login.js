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

const readline = require('readline/promises');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

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

  console.log('\n✔ Sesión autorizada correctamente.\n');
  console.log('Añade esta línea al archivo .env (sustituyendo la que haya):\n');
  console.log(`TELEGRAM_SESSION=${client.session.save()}`);
  console.log('\nDespués: pm2 restart inbox');

  await client.disconnect();
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fallo en la autorización:', err);
  process.exit(1);
});
