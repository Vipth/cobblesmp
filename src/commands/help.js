import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { isAdmin, EPHEMERAL } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List the commands available to you');

const byName = (a, b) => a.data.name.localeCompare(b.data.name);
const listFmt = (mods) =>
  mods.map((m) => `**/${m.data.name}** — ${m.data.description}`).join('\n') || '_none_';

export async function execute(interaction, { commands } = {}) {
  const mods = [...(commands?.values() ?? [])];
  const regular = mods.filter((m) => !m.adminOnly).sort(byName);
  const adminCmds = mods.filter((m) => m.adminOnly).sort(byName);

  const embed = new EmbedBuilder()
    .setTitle('CobbleSMP bot')
    .setColor(0x5865f2)
    .addFields({ name: 'Commands', value: listFmt(regular) });

  if (isAdmin(interaction)) {
    embed.addFields({ name: 'Admin commands', value: listFmt(adminCmds) });
  }

  await interaction.reply({ embeds: [embed], ...EPHEMERAL });
}
