import { SlashCommandBuilder } from 'discord.js';
import { assertTeleportDestination } from '../rcon.js';
import { runAdminRcon, resolveTarget } from '../rconCommand.js';

export const adminOnly = true;

export const data = new SlashCommandBuilder()
  .setName('tp')
  .setDescription('Teleport a player to another player or to coordinates')
  .addStringOption((o) =>
    o.setName('target').setDescription('Player to move (username or @mention)').setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName('destination')
      .setDescription('Another player name, or "x y z" coordinates')
      .setRequired(true),
  );

export async function execute(interaction) {
  const raw = interaction.options.getString('target', true);
  const destination = interaction.options.getString('destination', true);

  await runAdminRcon(interaction, {
    build: () => {
      const { mcName } = resolveTarget(raw);
      const dest = assertTeleportDestination(destination);
      return { command: `tp ${mcName} ${dest}`, summary: `teleported ${mcName} to ${dest}` };
    },
  });
}
