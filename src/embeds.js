import { EmbedBuilder } from 'discord.js';
import { skinRenderUrl } from './mojang.js';

/**
 * The "linked account" card shared by /whoami, /mcname and /discorduser.
 *
 * @param link  a row from the `links` table
 * @param opts.showDiscord  include the "Discord" field (off for /whoami — it's you)
 * @param opts.showUuid     include the UUID field (admins only)
 */
export function linkedAccountEmbed(link, { showDiscord = true, showUuid = false } = {}) {
  const fields = [];
  if (showDiscord) {
    fields.push({ name: 'Discord', value: `<@${link.discord_id}>`, inline: true });
  }
  fields.push({
    name: 'Linked',
    value: `<t:${Math.floor(link.linked_at / 1000)}:R>`,
    inline: true,
  });
  if (showUuid) {
    fields.push({ name: 'UUID', value: `\`${link.mc_uuid}\`` });
  }

  return new EmbedBuilder()
    .setTitle(link.mc_name)
    .setThumbnail(skinRenderUrl(link.mc_uuid))
    .setColor(0x5865f2)
    .addFields(fields);
}
