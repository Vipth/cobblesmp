/**
 * Standalone RCON connectivity check.
 *
 *   node src/rcon-check.js            # runs `list`
 *   node src/rcon-check.js "time query daytime"
 *
 * Reads RCON_HOST / RCON_PORT / RCON_PASSWORD from .env (same as the bot).
 * Prints a specific reason on failure so you can tell a DNS problem from a
 * firewall problem from a wrong password.
 */
import 'dotenv/config';
import { Rcon } from 'rcon-client';

const host = process.env.RCON_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.RCON_PORT || '25575', 10);
const password = process.env.RCON_PASSWORD || '';
const command = process.argv.slice(2).join(' ') || 'list';

if (!password) {
  console.error('RCON_PASSWORD is not set in .env — set it and try again.');
  process.exit(1);
}

console.log(`Connecting to ${host}:${port} …`);

try {
  const rcon = await Rcon.connect({ host, port, password, timeout: 8000 });
  console.log('✅ connected and authenticated');
  const res = await rcon.send(command);
  console.log(`\n> ${command}\n${res.trim() || '(no output)'}`);
  await rcon.end();
  process.exit(0);
} catch (err) {
  const code = err?.code;
  let hint = '';
  if (code === 'ENOTFOUND') hint = ' — hostname does not resolve (check RCON_HOST / DNS)';
  else if (code === 'ECONNREFUSED')
    hint =
      ' — nothing is listening there (RCON not enabled, wrong port, or no Pterodactyl allocation for it)';
  else if (code === 'ETIMEDOUT' || /timeout/i.test(err?.message ?? ''))
    hint = ' — reached the network but no response (firewall, or no tunnel/route to the RCON port)';
  else if (/auth/i.test(err?.message ?? '')) hint = ' — connected, but the password was rejected';
  console.error(`❌ ${err.message}${hint}`);
  process.exit(1);
}
