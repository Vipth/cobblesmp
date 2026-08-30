import { rcon } from './rcon.js';
import { parseList } from './parsers.js';

/**
 * Short-lived cache of `list` so a burst of /whoami /mcname /discorduser
 * doesn't hit RCON once per call.
 */

const TTL_MS = 20_000;
let cache = { at: 0, players: null }; // players: string[] | null (never reachable)

/** @returns {Promise<string[]|null>} online player names, or null if unknown */
export async function onlinePlayers() {
  if (cache.players !== null && Date.now() - cache.at < TTL_MS) return cache.players;
  try {
    const { players } = parseList(await rcon.send('list'));
    cache = { at: Date.now(), players };
  } catch {
    /* keep whatever we had (possibly null) */
  }
  return cache.players;
}

/** @returns {Promise<boolean|null>} true / false / null (server unreachable) */
export async function isOnline(mcName) {
  const players = await onlinePlayers();
  if (players === null) return null;
  const lc = String(mcName).toLowerCase();
  return players.some((p) => p.toLowerCase() === lc);
}
