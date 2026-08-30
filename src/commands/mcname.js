import { SlashCommandBuilder } from 'discord.js';
import { links } from '../db.js';
import { linkedAccountEmbed } from '../embeds.js';
import { isAdmin } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('mcname')
  .setDescription("Show a member's linked Minecraft account")
  .addUserOption((o) => o.setName('user').setDescription('Discord member').setRequired(true));

export async function execute(interaction) {
  const user = interaction.options.getUser('user', true);
  const link = links.getByDiscordId(user.id);
  if (!link) {
    return void interaction.reply({
      content: `<@${user.id}> has not linked a Minecraft account.`,
      allowedMentions: { parse: [] },
    });
  }

  const showUuid = isAdmin(interaction);
  await interaction.deferReply();
  await interaction.editReply({
    embeds: [await linkedAccountEmbed(link, { showUuid })],
    allowedMentions: { parse: [] },
  });
}
