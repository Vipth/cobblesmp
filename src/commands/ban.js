import { SlashCommandBuilder } from 'discord.js';
import { sanitizeReason, ValidationError } from '../rcon.js';
import { isAdmin, resolveTarget, EPHEMERAL } from '../rconCommand.js';
import { banEverywhere } from '../bansync.js';

export const adminOnly = true;

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a player on both Minecraft and Discord')
  .addStringOption((o) =>
    o
      .setName('target')
      .setDescription('Minecraft username, @mention, or Discord ID')
      .setRequired(true),
  )
  .addStringOption((o) => o.setName('reason').setDescription('Ban reason').setMaxLength(120))
  .addBooleanOption((o) =>
    o.setName('minecraft_only').setDescription('Ban in-game only — leave their Discord account alone'),
  );

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'You need the admin role to use this.', ...EPHEMERAL });
  }

  const raw = interaction.options.getString('target', true);
  const reason = sanitizeReason(interaction.options.getString('reason'));
  const mcOnly = interaction.options.getBoolean('minecraft_only') ?? false;

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
    const res = await banEverywhere({
      client: interaction.client,
      mcName: target.mcName,
      discordId: target.discordId,
      reason,
      initiatedBy: 'admin',
      moderatorTag: interaction.user.tag,
      mcOnly,
    });
    await interaction.editReply(`⛔ Banned \`${res.name}\` on Minecraft — ${res.discordResult}.`);
  } catch (err) {
    await interaction.editReply(`❌ ${err.message}`);
  }
}
