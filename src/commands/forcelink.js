import { SlashCommandBuilder } from 'discord.js';
import { links } from '../db.js';
import { assertMcName, ValidationError } from '../rcon.js';
import { lookupProfileByName, MojangError } from '../mojang.js';
import { addToWhitelist } from '../whitelist.js';
import { isAdmin, audit, EPHEMERAL } from '../rconCommand.js';

export const data = new SlashCommandBuilder()
  .setName('forcelink')
  .setDescription('Admin: link a Discord member to a Minecraft account')
  .addUserOption((o) => o.setName('user').setDescription('Discord member').setRequired(true))
  .addStringOption((o) =>
    o.setName('username').setDescription('Minecraft username').setRequired(true).setMaxLength(16),
  );

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'You need the admin role to use this.', ...EPHEMERAL });
  }
  await interaction.deferReply(EPHEMERAL);

  const user = interaction.options.getUser('user', true);
  let name;
  try {
    name = assertMcName(interaction.options.getString('username', true));
  } catch (err) {
    if (err instanceof ValidationError) return void interaction.editReply(`⚠️ ${err.message}`);
    throw err;
  }

  let profile;
  try {
    profile = await lookupProfileByName(name);
  } catch (err) {
    if (err instanceof MojangError) return void interaction.editReply(`⚠️ ${err.message}`);
    throw err;
  }
  if (!profile) return void interaction.editReply(`No Minecraft account named \`${name}\`.`);

  const clash = links.getByUuid(profile.id);
  if (clash && clash.discord_id !== user.id) {
    return void interaction.editReply(
      `\`${profile.name}\` is already linked to <@${clash.discord_id}>. Unlink that member first.`,
    );
  }

  links.deleteByDiscordId(user.id);
  if (clash) links.deleteByDiscordId(clash.discord_id);
  links.create({
    discordId: user.id,
    mcUuid: profile.id,
    mcName: profile.name,
    linkedBy: interaction.user.id,
  });

  let note = '';
  try {
    await addToWhitelist(profile.name);
  } catch (err) {
    note = ` (whitelist add failed: ${err.message})`;
  }

  await interaction.editReply(`🔗 Linked <@${user.id}> → \`${profile.name}\`.${note}`);
  await audit(
    interaction.client,
    `🔗 ${interaction.user.tag} force-linked <@${user.id}> → \`${profile.name}\``,
  );
}
