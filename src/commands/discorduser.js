import { SlashCommandBuilder } from 'discord.js';
import { links } from '../db.js';
import { assertMcName, ValidationError } from '../rcon.js';
import { linkedAccountEmbed } from '../embeds.js';
import { isAdmin, EPHEMERAL } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('discorduser')
  .setDescription('Find which Discord member owns a Minecraft username')
  .addStringOption((o) =>
    o.setName('username').setDescription('Minecraft username').setRequired(true).setMaxLength(16),
  );

export async function execute(interaction) {
  let name;
  try {
    name = assertMcName(interaction.options.getString('username', true));
  } catch (err) {
    if (err instanceof ValidationError) {
      return void interaction.reply({ content: `⚠️ ${err.message}`, ...EPHEMERAL });
    }
    throw err;
  }

  const link = links.getByName(name);
  if (!link) {
    return void interaction.reply({
      content: `\`${name}\` is not linked to any Discord member.`,
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
