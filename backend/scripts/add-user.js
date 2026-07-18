/**
 * Crea o actualiza un agente del panel.
 *
 * Uso:  node scripts/add-user.js <usuario> <contraseña> [nombre visible]
 * Ej.:  node scripts/add-user.js maria SuClaveSegura "María García"
 *
 * Si el usuario ya existe, se le cambia la contraseña (útil para resets).
 * Tras crear/cambiar usuarios: pm2 restart inbox
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { upsertAgent, countAgents } = require('../services/db');
const { hashPassword } = require('../services/auth');

const [username, password, displayName] = process.argv.slice(2);

if (!username || !password) {
  console.error('Uso: node scripts/add-user.js <usuario> <contraseña> [nombre visible]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

upsertAgent(username, hashPassword(password), displayName);
console.log(`✔ Agente "${username}" guardado. Total de agentes: ${countAgents()}`);
console.log('Aplica los cambios con: pm2 restart inbox');
