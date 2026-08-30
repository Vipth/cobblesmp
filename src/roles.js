import { config } from './config.js';
import { links } from './db.js';
import { audit } from './rconCommand.js';

/**
 * Keeps a "linked" Discord role in sync with the links table.
 *
 * Event-driven: /link and /forcelink grant it, /unlink removes it.
 * Periodic: a reconcile re-grants it to linked members who are missing it
 * (e.g. they left and rejoined, or the bot was down when they linked).
 *
 * Add-only — it never strips the role from someone, since enumerating every
 * role holder needs the privileged GuildMembers intent. Off unless LINKED_ROLE_ID
 * is set.
 */

const RECONCILE_INTERVAL_MS = 15 * 60_000;

const roleId = () => config.discord.linkedRoleId;
export const linkedRoleEnabled = () => Boolean(roleId());

async function fetchMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null; // not in the server
  }
}

export async function grantLinkedRole(guild, userId) {
  if (!linkedRoleEnabled() || !guild) return;
  const member = await fetchMember(guild, userId);
  if (!member || member.roles.cache.has(roleId())) return;
  try {
    await member.roles.add(roleId(), 'Linked a Minecraft account');
  } catch (err) {
    console.error(`[roles] could not add linked role to ${userId}: ${err.message}`);
  }
}

export async function revokeLinkedRole(guild, userId) {
  if (!linkedRoleEnabled() || !guild) return;
  const member = await fetchMember(guild, userId);
  if (!member || !member.roles.cache.has(roleId())) return;
  try {
    await member.roles.remove(roleId(), 'Unlinked their Minecraft account');
  } catch (err) {
    console.error(`[roles] could not remove linked role from ${userId}: ${err.message}`);
  }
}

let timer = null;

export function startRoleReconciler(client) {
  if (!linkedRoleEnabled()) {
    console.log('[roles] LINKED_ROLE_ID not set — linked-role sync disabled');
    return;
  }
  const tick = () =>
    reconcileLinkedRoles(client).catch((err) =>
      console.error('[roles] reconcile error:', err.message),
    );
  timer = setInterval(tick, RECONCILE_INTERVAL_MS);
  if (timer.unref) timer.unref();
  tick();
  console.log('[roles] linked-role reconciler started (every 15m)');
}

export function stopRoleReconciler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function reconcileLinkedRoles(client) {
  if (!linkedRoleEnabled()) return { added: 0, notInGuild: 0 };

  const guild = await client.guilds.fetch(config.discord.guildId);
  let added = 0;
  let notInGuild = 0;

  for (const link of links.all()) {
    const member = await fetchMember(guild, link.discord_id);
    if (!member) {
      notInGuild++;
      continue;
    }
    if (member.roles.cache.has(roleId())) continue;
    try {
      await member.roles.add(roleId(), 'Linked Minecraft account (reconcile)');
      added++;
    } catch (err) {
      console.error(`[roles] reconcile add failed for ${link.discord_id}: ${err.message}`);
    }
  }

  if (added) {
    await audit(
      client,
      `🎭 Linked-role sync: gave the role to ${added} member(s)` +
        (notInGuild ? ` (${notInGuild} linked account(s) have left the server)` : ''),
    );
  }
  return { added, notInGuild };
}
