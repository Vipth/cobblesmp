import { SlashCommandBuilder } from 'discord.js';
import { links } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('mcname')
  .setDescription("Show a member's linked Minecraft username")
  .addUserOption((o) => o.setName('user').setDescription('Discord member').setRequired(true));

export async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  const link = links.getByDiscordId(user.id);
  const content = link
    ? `<@${user.id}> → \`${link.mc_name}\``
    : `<@${user.id}> has not linked a Minecraft account.`;
  await interaction.reply({ content, allowedMentions: { parse: [] } });
}
