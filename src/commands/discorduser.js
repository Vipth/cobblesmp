import { SlashCommandBuilder } from 'discord.js';
import { links } from '../db.js';
import { assertMcName, ValidationError } from '../rcon.js';
import { EPHEMERAL } from '../rconCommand.js';

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
  const content = link
    ? `\`${link.mc_name}\` → <@${link.discord_id}>`
    : `\`${name}\` is not linked to any Discord member.`;
  await interaction.reply({ content, allowedMentions: { parse: [] } });
}
