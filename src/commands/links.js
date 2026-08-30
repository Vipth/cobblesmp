import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { links } from '../db.js';
import { isAdmin, EPHEMERAL } from '../rconCommand.js';

const PAGE_SIZE = 15;

export const data = new SlashCommandBuilder()
  .setName('links')
  .setDescription('Admin: list all linked accounts')
  .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1));

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'You need the admin role to use this.', ...EPHEMERAL });
  }

  const all = links.all();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(interaction.options.getInteger('page') ?? 1, pages);
  const rows = all
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((l) => `\`${l.mc_name}\` — <@${l.discord_id}>`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`Linked accounts (${all.length})`)
    .setDescription(rows || '(none yet)')
    .setFooter({ text: `Page ${page}/${pages}` })
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, ...EPHEMERAL });
}
