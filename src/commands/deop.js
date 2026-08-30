import { SlashCommandBuilder } from 'discord.js';
import { runAdminRcon, resolveTarget } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('deop')
  .setDescription('Revoke operator status from a player')
  .addStringOption((o) =>
    o.setName('target').setDescription('Minecraft username or @mention').setRequired(true),
  );

export async function execute(interaction) {
  const raw = interaction.options.getString('target', true);
  await runAdminRcon(interaction, {
    build: () => {
      const { mcName } = resolveTarget(raw);
      return { command: `deop ${mcName}`, summary: `de-opped ${mcName}` };
    },
  });
}
