import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { links } from '../db.js';
import { skinRenderUrl } from '../mojang.js';
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

  const embed = new EmbedBuilder()
    .setTitle(link.mc_name)
    .addFields(
      { name: 'UUID', value: `\`${link.mc_uuid}\`` },
      { name: 'Linked', value: `<t:${Math.floor(link.linked_at / 1000)}:R>` },
    )
    .setThumbnail(skinRenderUrl(link.mc_uuid))
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed], ...EPHEMERAL });
}
