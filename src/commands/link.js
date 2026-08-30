import { SlashCommandBuilder, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { links } from '../db.js';
import { assertMcName, ValidationError } from '../rcon.js';
import { lookupProfileByName, MojangError, skinRenderUrl } from '../mojang.js';
import { addToWhitelist } from '../whitelist.js';
import { grantLinkedRole } from '../roles.js';
import { isLinkingOpen } from '../state.js';
import { audit, EPHEMERAL } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Minecraft account to your Discord account')
  .addStringOption((o) =>
    o
      .setName('username')
      .setDescription('Your exact Minecraft (Java) username')
      .setRequired(true)
      .setMaxLength(16),
  );

export async function execute(interaction) {
  const input = interaction.options.getString('username', true);
  await interaction.deferReply(EPHEMERAL);

  let name;
  try {
    name = assertMcName(input);
  } catch (err) {
    if (err instanceof ValidationError) return void interaction.editReply(`⚠️ ${err.message}`);
    throw err;
  }

  const mine = links.getByDiscordId(interaction.user.id);
  if (mine) {
    return void interaction.editReply(
      `You're already linked to \`${mine.mc_name}\`. Use \`/unlink\` first if you need to change it.`,
    );
  }

  if (!isLinkingOpen()) {
    return void interaction.editReply(
      '🔒 Linking is temporarily closed. Try again later — an admin will reopen it.',
    );
  }

  let profile;
  try {
    profile = await lookupProfileByName(name);
  } catch (err) {
    if (err instanceof MojangError) return void interaction.editReply(`⚠️ ${err.message}`);
    throw err;
  }
  if (!profile) {
    return void interaction.editReply(`No Minecraft (Java) account named \`${name}\` exists.`);
  }

  const clash = links.getByUuid(profile.id);
  if (clash) {
    return void interaction.editReply(
      `\`${profile.name}\` is already linked to <@${clash.discord_id}>.`,
    );
  }

  links.create({
    discordId: interaction.user.id,
    mcUuid: profile.id,
    mcName: profile.name,
    linkedBy: interaction.user.id,
  });

  let note = null;
  try {
    await addToWhitelist(profile.name);
  } catch (err) {
    note = `⚠️ Linked, but I couldn't whitelist you automatically (${err.message}). An admin can run \`/whitelist add\`.`;
  }

  await grantLinkedRole(interaction.guild, interaction.user.id);

  const embed = new EmbedBuilder()
    .setTitle('Account linked')
    .setDescription(`**${escapeMarkdown(profile.name)}** is now linked to <@${interaction.user.id}>.`)
    .setThumbnail(skinRenderUrl(profile.id))
    .setColor(0x33aa55);

  await interaction.editReply({ content: note, embeds: [embed] });
  await audit(interaction.client, `🔗 <@${interaction.user.id}> linked \`${profile.name}\``);
}
