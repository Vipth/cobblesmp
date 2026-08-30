import { EmbedBuilder } from 'discord.js';
import { skinRenderUrl, fetchTextures } from './mojang.js';
import { isOnline } from './serverquery.js';
import { banState } from './db.js';

/**
 * The "linked account" card shared by /whoami, /mcname and /discorduser.
 * Async — it pulls live online status (cached), ban state (from the ban poller's
 * table, free) and the cape flag (from Mojang's texture blob, cached).
 *
 * @param link  a row from the `links` table
 * @param opts.showDiscord  include the "Discord" field (off for /whoami — it's you)
 * @param opts.showUuid     include UUID + "Linked by" (admins only)
 */
export async function linkedAccountEmbed(link, { showDiscord = true, showUuid = false } = {}) {
  const [online, textures] = await Promise.all([
    isOnline(link.mc_name),
    fetchTextures(link.mc_uuid).catch(() => null),
  ]);
  const banned = banState.has(link.mc_name);

  let status = null;
  if (banned) status = '⛔ Banned';
  else if (online === true) status = '🟢 Online';
  else if (online === false) status = '⚫ Offline';

  const color = banned ? 0xcc3333 : online ? 0x43b581 : 0x5865f2;

  const fields = [];
  if (status) fields.push({ name: 'Status', value: status, inline: true });
  if (showDiscord) fields.push({ name: 'Discord', value: `<@${link.discord_id}>`, inline: true });
  fields.push({
    name: 'Linked',
    value: `<t:${Math.floor(link.linked_at / 1000)}:R>`,
    inline: true,
  });
  if (textures?.capeUrl) {
    fields.push({ name: 'Cape', value: `[texture](${textures.capeUrl})`, inline: true });
  }
  if (showUuid) {
    fields.push({ name: 'UUID', value: `\`${link.mc_uuid}\`` });
    if (link.linked_by && link.linked_by !== link.discord_id) {
      fields.push({ name: 'Linked by', value: `<@${link.linked_by}> (admin)`, inline: true });
    }
  }

  return new EmbedBuilder()
    .setTitle(link.mc_name)
    .setURL(`https://namemc.com/profile/${link.mc_uuid.replace(/-/g, '')}`)
    .setThumbnail(skinRenderUrl(link.mc_uuid))
    .setColor(color)
    .addFields(fields);
}
