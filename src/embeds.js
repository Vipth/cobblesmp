import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { skinRenderUrl } from './mojang.js';
import { isOnline } from './serverquery.js';
import { banState, banActions, presence } from './db.js';
import { formatDuration } from './duration.js';

/**
 * The "linked account" card shared by /whoami, /mcname and /discorduser.
 * Async — it pulls live online status (cached), ban state and playtime (both
 * from local tables, free).
 *
 * @param link  a row from the `links` table
 * @param opts.showDiscord  include the "Discord" field (off for /whoami — it's you)
 * @param opts.showUuid     include UUID + "Linked by" (admins only)
 */
export async function linkedAccountEmbed(link, { showDiscord = true, showUuid = false } = {}) {
  const online = await isOnline(link.mc_name);
  const banned = banState.has(link.mc_name);
  const pRow = presence.get(link.mc_uuid);

  let status = null;
  if (banned) {
    const lastBan = banActions.lastBan(link.mc_name);
    status = lastBan ? `⛔ Banned <t:${Math.floor(lastBan.ts / 1000)}:R>` : '⛔ Banned';
  } else if (online === true) {
    const session = pRow?.session_start
      ? ` · ${formatDuration(Date.now() - pRow.session_start)} this session`
      : '';
    status = `🟢 Online${session}`;
  } else if (online === false) status = '⚫ Offline';

  const color = banned ? 0xcc3333 : online ? 0x43b581 : 0x5865f2;

  const fields = [];
  if (status) fields.push({ name: 'Status', value: status, inline: true });
  if (showDiscord) fields.push({ name: 'Discord', value: `<@${link.discord_id}>`, inline: true });
  fields.push({
    name: 'Linked',
    value: `<t:${Math.floor(link.linked_at / 1000)}:R>`,
    inline: true,
  });

  if (pRow) {
    const total = presence.total(pRow);
    if (total >= 60_000) {
      fields.push({ name: 'Playtime', value: formatDuration(total), inline: true });
    }
    if (!pRow.session_start) {
      fields.push({
        name: 'Last seen',
        value: `<t:${Math.floor(pRow.last_seen / 1000)}:R>`,
        inline: true,
      });
    }
  }

  if (showUuid) {
    fields.push({ name: 'UUID', value: `\`${link.mc_uuid}\`` });
    if (link.linked_by && link.linked_by !== link.discord_id) {
      fields.push({ name: 'Linked by', value: `<@${link.linked_by}> (admin)`, inline: true });
    }
  }

  return new EmbedBuilder()
    .setTitle(escapeMarkdown(link.mc_name))
    .setURL(`https://namemc.com/profile/${link.mc_uuid.replace(/-/g, '')}`)
    .setThumbnail(skinRenderUrl(link.mc_uuid))
    .setColor(color)
    .addFields(fields);
}
