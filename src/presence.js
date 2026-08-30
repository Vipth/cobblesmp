import { config } from './config.js';
import { links, presence } from './db.js';
import { rcon } from './rcon.js';
import { parseList } from './parsers.js';

/**
 * Presence poller: runs `list` over RCON on an interval, diffs the online set,
 * and from that tracks playtime / last-seen / first-join and (optionally) posts
 * a join/leave feed. Everything is keyed by MC UUID via the links table, so name
 * changes don't lose playtime and only linked players are tracked.
 *
 * Mirrors src/bansync.js (interval + primed flag).
 */

let timer = null;
let primed = false;
const warnedUnlinked = new Set(); // names logged as "online but unlinked" this session

export function startPresencePoller(client) {
  if (!config.presence.enabled) {
    console.log('[presence] PRESENCE_ENABLED=false — presence poller disabled');
    return;
  }
  const tick = () =>
    pollOnce(client).catch((err) => console.error('[presence] poll error:', err.message));
  timer = setInterval(tick, config.presence.intervalMs);
  if (timer.unref) timer.unref();
  tick();
  console.log(
    `[presence] poller started (every ${Math.round(config.presence.intervalMs / 1000)}s, ` +
      `feed ${config.presence.channelId ? 'on' : 'off'})`,
  );
}

export function stopPresencePoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function pollOnce(client) {
  const text = await rcon.send('list');
  // a real `list` response always mentions "player(s) online" — anything else is
  // a transient glitch; skip the diff rather than mark everyone offline
  if (!/player/i.test(text)) {
    console.warn('[presence] unexpected `list` output, skipping this cycle');
    return;
  }

  const { players } = parseList(text);
  const now = Date.now();

  const onlineLinks = [];
  for (const name of players) {
    const link = links.getByName(name);
    if (link) {
      onlineLinks.push(link);
    } else if (!warnedUnlinked.has(name.toLowerCase())) {
      warnedUnlinked.add(name.toLowerCase());
      console.warn(`[presence] ${name} is online but not linked — not tracking`);
    }
  }
  const onlineUuids = new Set(onlineLinks.map((l) => l.mc_uuid));

  // first poll after startup: adopt the current online set, fire nothing
  if (!primed) {
    for (const link of onlineLinks) presence.markOnline(link.mc_uuid, link.mc_name, now);
    for (const row of presence.online()) {
      if (!onlineUuids.has(row.mc_uuid)) presence.markOffline(row.mc_uuid, now);
    }
    primed = true;
    console.log(`[presence] primed — ${onlineLinks.length} online`);
    return;
  }

  // joins + still-online
  for (const link of onlineLinks) {
    const row = presence.get(link.mc_uuid);
    if (!row || row.session_start == null) {
      presence.markOnline(link.mc_uuid, link.mc_name, now);
      await postJoin(client, link, !row);
    } else {
      presence.accrue(link.mc_uuid, now);
      presence.touch(link.mc_uuid, link.mc_name, now);
    }
  }

  // leaves
  for (const row of presence.online()) {
    if (onlineUuids.has(row.mc_uuid)) continue;
    presence.markOffline(row.mc_uuid, now);
    await postLeave(client, row);
  }
}

async function feedChannel(client) {
  if (!config.presence.channelId) return null;
  try {
    const ch = await client.channels.fetch(config.presence.channelId);
    return ch?.isTextBased() ? ch : null;
  } catch {
    return null;
  }
}

async function postJoin(client, link, firstEver) {
  const ch = await feedChannel(client);
  if (!ch) return;
  const who = config.presence.mention ? `<@${link.discord_id}>` : `**${link.mc_name}**`;
  const content = firstEver
    ? `🎉 ${who} joined **CobbleSMP** for the first time!`
    : `→ ${who} joined`;
  await ch
    .send({
      content,
      allowedMentions: config.presence.mention ? { users: [link.discord_id] } : { parse: [] },
    })
    .catch((err) => console.error('[presence] join post failed:', err.message));
}

async function postLeave(client, row) {
  const ch = await feedChannel(client);
  if (!ch) return;
  await ch
    .send({ content: `← **${row.mc_name}** left`, allowedMentions: { parse: [] } })
    .catch((err) => console.error('[presence] leave post failed:', err.message));
}
