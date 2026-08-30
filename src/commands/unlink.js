import { SlashCommandBuilder } from 'discord.js';
import { links } from '../db.js';
import { removeFromWhitelist } from '../whitelist.js';
import { audit, EPHEMERAL } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Remove the link to your Minecraft account');

export async function execute(interaction) {
  await interaction.deferReply(EPHEMERAL);
  const link = links.getByDiscordId(interaction.user.id);
  if (!link) return void interaction.editReply("You don't have a linked account.");

  links.deleteByDiscordId(interaction.user.id);

  let note = '';
  try {
    await removeFromWhitelist(link.mc_name, 'Unlinked from Discord');
  } catch (err) {
    note = ` (couldn't update the whitelist: ${err.message})`;
  }

  await interaction.editReply(`Unlinked \`${link.mc_name}\`.${note}`);
  await audit(interaction.client, `🔗 <@${interaction.user.id}> unlinked \`${link.mc_name}\``);
}
