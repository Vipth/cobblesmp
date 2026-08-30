import { SlashCommandBuilder } from 'discord.js';
import { sanitizeReason } from '../rcon.js';
import { runAdminRcon, resolveTarget } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a player from the server')
  .addStringOption((o) =>
    o.setName('target').setDescription('Minecraft username or @mention').setRequired(true),
  )
  .addStringOption((o) => o.setName('reason').setDescription('Kick reason').setMaxLength(120));

export async function execute(interaction) {
  const raw = interaction.options.getString('target', true);
  const reason = sanitizeReason(interaction.options.getString('reason'));

  await runAdminRcon(interaction, {
    build: () => {
      const { mcName } = resolveTarget(raw);
      return {
        command: reason ? `kick ${mcName} ${reason}` : `kick ${mcName}`,
        summary: `kicked ${mcName}`,
      };
    },
  });
}
