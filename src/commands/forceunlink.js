import { SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import { links } from '../db.js';
import { assertMcName, ValidationError } from '../rcon.js';
import { removeFromWhitelist } from '../whitelist.js';
import { revokeLinkedRole } from '../roles.js';
import { isAdmin, audit, EPHEMERAL } from '../rconCommand.js';

export const adminOnly = true;

export const data = new SlashCommandBuilder()
  .setName('forceunlink')
  .setDescription("Admin: remove a member's Minecraft link")
  .addUserOption((o) => o.setName('user').setDescription('Discord member to unlink'))
  .addStringOption((o) =>
    o.setName('username').setDescription('...or the Minecraft username to unlink').setMaxLength(16),
  );

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'You need the admin role to use this.', ...EPHEMERAL });
  }
  await interaction.deferReply(EPHEMERAL);

  const user = interaction.options.getUser('user');
  const rawName = interaction.options.getString('username');
  if (!user && !rawName) {
    return void interaction.editReply('Give me either a `user` or a `username`.');
  }

  let link;
  if (user) {
    link = links.getByDiscordId(user.id);
  } else {
    let name;
    try {
      name = assertMcName(rawName);
    } catch (err) {
      if (err instanceof ValidationError) return void interaction.editReply(`⚠️ ${err.message}`);
      throw err;
    }
    link = links.getByName(name);
  }

  if (!link) {
    return void interaction.editReply(
      user ? `<@${user.id}> has no linked account.` : `\`${rawName}\` is not linked to anyone.`,
    );
  }

  links.deleteByDiscordId(link.discord_id);

  let note = '';
  try {
    await removeFromWhitelist(link.mc_name, 'Link removed by an admin');
  } catch (err) {
    note = ` (whitelist update failed: ${err.message})`;
  }
  await revokeLinkedRole(interaction.guild, link.discord_id);

  await interaction.editReply(
    `🔗 Removed the link between <@${link.discord_id}> and \`${link.mc_name}\`.${note}`,
  );
  await audit(
    interaction.client,
    `🔗 ${escapeMarkdown(interaction.user.tag)} force-unlinked <@${link.discord_id}> (was \`${link.mc_name}\`)`,
  );
}
