import { escapeMarkdown } from 'discord.js';
import { config } from './config.js';
import { links } from './db.js';
import { rcon, assertMcName } from './rcon.js';
import { parseWhitelist } from './parsers.js';
import { audit } from './rconCommand.js';

/**
 * Keeps the Minecraft server whitelist in line with the `links` table so that a
 * player must have a Discord link to join.
 *
 *   off      - nothing (only /link add + /unlink remove, as before)
 *   additive - `whitelist on`, add every linked user, REPORT unlinked entries
 *   strict   - additive + REMOVE and kick unlinked / non-exempt entries
 *
 * Mirrors the structure of bansync.js (interval poller + primitive helpers).
 */

const lc = (s) => String(s).toLowerCase();

let whitelistOn = false; // did we send `whitelist on` yet this process?
let firstRunDone = false; // have we posted the startup summary yet?
let lastExtras = new Set(); // lowercased unlinked names last reported (additive)
let timer = null;

export async function addToWhitelist(mcName) {
  return rcon.send(`whitelist add ${assertMcName(mcName)}`);
}

export async function removeFromWhitelist(mcName, reason = 'Removed from the whitelist') {
  const name = assertMcName(mcName);
  await rcon.send(`whitelist remove ${name}`);
  await rcon.send(`kick ${name} ${reason}`).catch(() => {}); // offline -> ignore
}

export function startWhitelistReconciler(client) {
  if (config.whitelist.mode === 'off') {
    console.log('[whitelist] WHITELIST_MODE=off — reconciler disabled');
    return;
  }
  const tick = () =>
    reconcileWhitelist(client).catch((err) =>
      console.error('[whitelist] reconcile error:', err.message),
    );
  timer = setInterval(tick, config.whitelist.reconcileIntervalMs);
  if (timer.unref) timer.unref();
  tick(); // run once immediately
  console.log(
    `[whitelist] reconciler started (mode=${config.whitelist.mode}, every ${Math.round(
      config.whitelist.reconcileIntervalMs / 1000,
    )}s)`,
  );
}

export function stopWhitelistReconciler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Bring the server whitelist in line with the links table.
 * @returns {Promise<{
 *   skipped?: string, added: string[], reported: string[], removed: string[],
 *   serverCount: number, linkedCount: number
 * }>}
 */
export async function reconcileWhitelist(client) {
  const mode = config.whitelist.mode;
  if (mode === 'off') {
    return { skipped: 'WHITELIST_MODE is off', added: [], reported: [], removed: [], serverCount: 0, linkedCount: 0 };
  }

  // 1. make sure the whitelist gate is actually on (once per process)
  if (!whitelistOn) {
    await rcon.send('whitelist on');
    whitelistOn = true;
  }

  // 2. read the current server whitelist (a query — not broadcast to ops)
  const serverNames = parseWhitelist(await rcon.send('whitelist list')).names;
  const serverSet = new Set(serverNames.map(lc));

  // 3. desired = linked names + exempt names
  const linked = links.all();
  const linkedSet = new Set(linked.map((l) => lc(l.mc_name)));
  const exemptSet = new Set(config.whitelist.exempt);

  // 4. linked but not whitelisted -> add
  const added = [];
  for (const l of linked) {
    if (serverSet.has(lc(l.mc_name))) continue;
    try {
      await addToWhitelist(l.mc_name);
      added.push(l.mc_name);
    } catch (err) {
      console.error(`[whitelist] could not add ${l.mc_name}: ${err.message}`);
    }
  }

  // 5. whitelisted but not linked and not exempt
  const extras = serverNames.filter((n) => !linkedSet.has(lc(n)) && !exemptSet.has(lc(n)));
  const removed = [];
  const reported = [];

  if (mode === 'strict') {
    for (const n of extras) {
      try {
        await removeFromWhitelist(n, 'Not linked to Discord — use /link in the CobbleSMP server');
        removed.push(n);
      } catch (err) {
        console.error(`[whitelist] could not remove ${n}: ${err.message}`);
      }
    }
  } else {
    reported.push(...extras);
    const extrasSet = new Set(extras.map(lc));
    const changed =
      extrasSet.size !== lastExtras.size || [...extrasSet].some((n) => !lastExtras.has(n));
    if (extras.length && (changed || !firstRunDone)) {
      await audit(
        client,
        `⚠️ ${extras.length} whitelisted account(s) with no Discord link: ` +
          `${extras.map((n) => `\`${n}\``).join(', ')}\n` +
          'They stay whitelisted until `WHITELIST_MODE=strict`. Ask them to `/link`.',
      );
    }
    lastExtras = extrasSet;
  }

  if (removed.length) await rcon.send('whitelist reload').catch(() => {});

  // 6. summaries
  if (!firstRunDone) {
    firstRunDone = true;
    await audit(
      client,
      `🔒 Whitelist enforcement **${mode}**. ` +
        `Server whitelist: ${serverNames.length} • linked: ${linked.length}` +
        (added.length ? ` • added ${added.length} missing` : '') +
        (removed.length ? ` • removed ${removed.length} unlinked` : '') +
        (mode !== 'strict' && extras.length ? ` • ${extras.length} unlinked still allowed` : ''),
    );
  } else if (added.length || removed.length) {
    await audit(
      client,
      '🔒 Whitelist reconcile:' +
        (added.length ? ` +${added.length} (${added.map(escapeMarkdown).join(', ')})` : '') +
        (removed.length ? ` −${removed.length} (${removed.map(escapeMarkdown).join(', ')})` : ''),
    );
  }

  return {
    added,
    reported,
    removed,
    serverCount: serverNames.length,
    linkedCount: linked.length,
  };
}
