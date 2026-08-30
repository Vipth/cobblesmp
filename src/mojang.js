/**
 * Minimal Mojang / Minecraft Services profile lookups.
 *
 * We only use this to (a) confirm a username actually exists at link time and
 * (b) store the canonical casing + UUID so links survive name changes.
 */

const LOOKUP_URL = 'https://api.minecraftservices.com/minecraft/profile/lookup/name/';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const cache = new Map(); // lowercased name -> { profile, expires }

export class MojangError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'MojangError';
    this.retryable = retryable;
  }
}

function dashUuid(id) {
  if (id.includes('-')) return id;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

/**
 * @param {string} name
 * @returns {Promise<{ id: string, name: string } | null>} null when the name does not exist
 */
export async function lookupProfileByName(name) {
  const key = String(name).toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.profile;

  let res;
  try {
    res = await fetch(LOOKUP_URL + encodeURIComponent(name), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    throw new MojangError(`Could not reach Mojang (${err.message}).`, { retryable: true });
  }

  if (res.status === 404 || res.status === 204) {
    cache.set(key, { profile: null, expires: Date.now() + CACHE_TTL_MS });
    return null;
  }
  if (res.status === 429) {
    throw new MojangError('Mojang rate limit hit, try again in a minute.', { retryable: true });
  }
  if (!res.ok) {
    throw new MojangError(`Mojang returned HTTP ${res.status}.`, { retryable: res.status >= 500 });
  }

  const body = await res.json();
  if (!body?.id || !body?.name) {
    throw new MojangError('Unexpected response from Mojang.', { retryable: true });
  }

  const profile = { id: dashUuid(body.id), name: body.name };
  cache.set(key, { profile, expires: Date.now() + CACHE_TTL_MS });
  // also index by canonical name
  cache.set(profile.name.toLowerCase(), { profile, expires: Date.now() + CACHE_TTL_MS });
  return profile;
}

/** For refreshing a stored link: resolve the current name for a known UUID. */
export async function lookupNameByUuid(uuid) {
  const id = uuid.replace(/-/g, '');
  let res;
  try {
    res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    throw new MojangError(`Could not reach Mojang (${err.message}).`, { retryable: true });
  }
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new MojangError(`Mojang returned HTTP ${res.status}.`, { retryable: true });
  const body = await res.json();
  return body?.name ?? null;
}

export function skinRenderUrl(uuidOrName) {
  // Crafatar renders from UUID or name; used only for a thumbnail in embeds.
  const id = String(uuidOrName).replace(/-/g, '');
  return `https://crafatar.com/avatars/${id}?size=128&overlay`;
}
