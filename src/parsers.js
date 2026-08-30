/**
 * Parsers for the plain-text responses vanilla / Fabric servers return over RCON.
 * Kept pure and dependency-free so they can be unit tested against captured fixtures.
 */

const MC_NAME = /^[A-Za-z0-9_]{1,16}$/;

/** Remove legacy section-sign colour codes (§x) that some servers include. */
export function stripFormatting(text) {
  return String(text).replace(/§[0-9a-fk-or]/gi, '');
}

/**
 * Parse the output of `list`.
 * Examples:
 *   "There are 2 of a max of 20 players online: Alice, Bob"
 *   "There are 0 of a max of 20 players online:"
 *   "There are 1/20 players online: Alice"
 * @returns {{ online: number, max: number|null, players: string[] }}
 */
export function parseList(text) {
  const clean = stripFormatting(text).trim();
  const colon = clean.indexOf(':');
  const head = colon === -1 ? clean : clean.slice(0, colon);
  const tail = colon === -1 ? '' : clean.slice(colon + 1);

  const nums = head.match(/\d+/g)?.map(Number) ?? [];
  const online = nums[0] ?? 0;
  const max = nums.length > 1 ? nums[1] : null;

  const players = tail
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    // guard against a trailing sentence rather than a name list
    .filter((s) => MC_NAME.test(s));

  return { online, max, players };
}

/**
 * Parse the output of `whitelist list`.
 * Examples:
 *   "There are 3 whitelisted players: Alice, Bob, Carol"
 *   "There are 3 whitelisted player(s): Alice, Bob, Carol"
 *   "There are no whitelisted players"
 * @returns {{ names: string[] }}
 */
export function parseWhitelist(text) {
  const clean = stripFormatting(text).trim();
  const colon = clean.indexOf(':');
  const tail = colon === -1 ? '' : clean.slice(colon + 1);

  const names = tail
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => MC_NAME.test(s));

  return { names };
}

/**
 * Parse the output of `banlist` / `banlist players`.
 * Examples:
 *   "There are no bans"
 *   "There are 2 ban(s):\nAlice was banned by Server: griefing\nBob was banned by Operator: (No reason given)"
 * IP-ban lines (from a bare `banlist`) are ignored because an IP never matches MC_NAME.
 * @returns {{ names: string[], entries: Array<{ name: string, source: string, reason: string|null }> }}
 */
export function parseBanlist(text) {
  const clean = stripFormatting(text);
  const entries = [];

  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const m = line.match(/^(\S+)\s+was banned by\s+(.+?):\s*(.*)$/i);
    if (!m) continue;

    const [, name, source, reasonRaw] = m;
    if (!MC_NAME.test(name)) continue; // skip IP bans / malformed lines

    const reason =
      !reasonRaw || /^\(no reason given\)\.?$/i.test(reasonRaw.trim())
        ? null
        : reasonRaw.trim();

    entries.push({ name, source: source.trim(), reason });
  }

  return { names: entries.map((e) => e.name), entries };
}
