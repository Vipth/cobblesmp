import { SlashCommandBuilder } from 'discord.js';
import { ValidationError } from '../rcon.js';
import { isAdmin, resolveTarget, EPHEMERAL } from '../rconCommand.js';
import { pardonEverywhere } from '../bansync.js';

export const data = new SlashCommandBuilder()
  .setName('pardon')
  .setDescription('Unban a player on both Minecraft and Discord')
  .addStringOption((o) =>
    o
      .setName('target')
      .setDescription('Minecraft username, @mention, or Discord ID')
      .setRequired(true),
  );

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'You need the admin role to use this.', ...EPHEMERAL });
  }

  const raw = interaction.options.getString('target', true);

  let target;
  try {
    target = resolveTarget(raw);
  } catch (err) {
    if (err instanceof ValidationError) {
      return void interaction.reply({ content: `⚠️ ${err.message}`, ...EPHEMERAL });
    }
    throw err;
  }

  await interaction.deferReply(EPHEMERAL);
  try {
    const res = await pardonEverywhere({
      client: interaction.client,
      mcName: target.mcName,
      discordId: target.discordId,
      initiatedBy: 'admin',
      moderatorTag: interaction.user.tag,
    });
    await interaction.editReply(`♻️ Pardoned \`${res.name}\` on Minecraft — ${res.discordResult}.`);
  } catch (err) {
    await interaction.editReply(`❌ ${err.message}`);
  }
}
