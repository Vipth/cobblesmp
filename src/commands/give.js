import { SlashCommandBuilder } from 'discord.js';
import { assertItemId, clampCount } from '../rcon.js';
import { runAdminRcon, resolveTarget } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('give')
  .setDescription('Give an item to a player')
  .addStringOption((o) =>
    o.setName('target').setDescription('Minecraft username or @mention').setRequired(true),
  )
  .addStringOption((o) =>
    o.setName('item').setDescription('Item id, e.g. minecraft:diamond').setRequired(true),
  )
  .addIntegerOption((o) =>
    o.setName('count').setDescription('1-64 (default 1)').setMinValue(1).setMaxValue(64),
  );

export async function execute(interaction) {
  const raw = interaction.options.getString('target', true);
  const item = interaction.options.getString('item', true);
  const count = interaction.options.getInteger('count') ?? 1;

  await runAdminRcon(interaction, {
    build: () => {
      const { mcName } = resolveTarget(raw);
      const id = assertItemId(item);
      const n = clampCount(count);
      return { command: `give ${mcName} ${id} ${n}`, summary: `gave ${mcName} ${n}× ${id}` };
    },
  });
}
