import { SlashCommandBuilder } from 'discord.js';
import { links } from '../db.js';
import { linkedAccountEmbed } from '../embeds.js';
import { EPHEMERAL } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('whoami')
  .setDescription('Show your linked Minecraft account');

export async function execute(interaction) {
  const link = links.getByDiscordId(interaction.user.id);
  if (!link) {
    return void interaction.reply({
      content: "You haven't linked an account yet. Use `/link <username>`.",
      ...EPHEMERAL,
    });
  }

  await interaction.deferReply(EPHEMERAL);
  await interaction.editReply({
    embeds: [await linkedAccountEmbed(link, { showDiscord: false })],
  });
}
