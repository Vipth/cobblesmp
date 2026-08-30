import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { presence } from '../db.js';
import { formatDuration } from '../duration.js';

const PAGE_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Playtime leaderboard');

function render(page) {
  const now = Date.now();
  const all = presence.topByPlaytime(1000, now).filter((r) => r.total_ms >= 60_000);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const p = Math.min(Math.max(page, 1), pages);
  const start = (p - 1) * PAGE_SIZE;

  const body =
    all
      .slice(start, start + PAGE_SIZE)
      .map((r, i) => {
        const rank = MEDALS[start + i] ?? `**${start + i + 1}.**`;
        const dot = r.session_start ? ' 🟢' : '';
        return `${rank} \`${r.mc_name}\`${dot} — ${formatDuration(r.total_ms)}`;
      })
      .join('\n') || 'No playtime tracked yet.';

  const embed = new EmbedBuilder()
    .setTitle('⏱️ Playtime leaderboard')
    .setDescription(body)
    .setFooter({ text: `Page ${p}/${pages}` })
    .setColor(0x43b581);

  const components =
    pages > 1
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`leaderboard:${p - 1}`)
              .setLabel('◀ Prev')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(p <= 1),
            new ButtonBuilder()
              .setCustomId(`leaderboard:${p + 1}`)
              .setLabel('Next ▶')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(p >= pages),
          ),
        ]
      : [];

  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

export async function execute(interaction) {
  await interaction.reply(render(1));
}

export async function handleButton(interaction) {
  const page = Number.parseInt(interaction.customId.split(':')[1], 10) || 1;
  await interaction.update(render(page));
}
