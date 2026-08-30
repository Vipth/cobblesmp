import { SlashCommandBuilder, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { links, presence } from '../db.js';
import { formatDuration } from '../duration.js';
import { skinRenderUrl } from '../mojang.js';

export const data = new SlashCommandBuilder()
  .setName('playtime')
  .setDescription('Show playtime for you or another member')
  .addUserOption((o) => o.setName('user').setDescription('Discord member (default: you)'));

export async function execute(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const self = user.id === interaction.user.id;

  const link = links.getByDiscordId(user.id);
  if (!link) {
    return void interaction.reply({
      content: self ? "You haven't linked an account." : `<@${user.id}> hasn't linked an account.`,
      allowedMentions: { parse: [] },
    });
  }

  const row = presence.get(link.mc_uuid);
  if (!row) {
    return void interaction.reply({
      content: `No playtime tracked for \`${link.mc_name}\` yet.`,
      allowedMentions: { parse: [] },
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`${escapeMarkdown(link.mc_name)} — playtime`)
    .setThumbnail(skinRenderUrl(link.mc_uuid))
    .setColor(0x43b581)
    .addFields(
      { name: 'Total', value: formatDuration(presence.total(row)), inline: true },
      row.session_start
        ? {
            name: 'Online now',
            value: `${formatDuration(Date.now() - row.session_start)} this session`,
            inline: true,
          }
        : {
            name: 'Last seen',
            value: `<t:${Math.floor(row.last_seen / 1000)}:R>`,
            inline: true,
          },
      { name: 'First joined', value: `<t:${Math.floor(row.first_seen / 1000)}:R>`, inline: true },
    );

  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}
