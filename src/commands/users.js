import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { links } from '../db.js';
import { isAdmin, EPHEMERAL } from '../rconCommand.js';

const PAGE_SIZE = 15;

export const adminOnly = true;

export const data = new SlashCommandBuilder()
  .setName('users')
  .setDescription('Admin: list every synced account');

/** Build the message payload for a given page (data is re-read each time). */
function render(page) {
  const all = links.all();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const p = Math.min(Math.max(page, 1), pages);

  const body = all
    .slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE)
    .map(
      (l) =>
        `\`${l.mc_name}\` — <@${l.discord_id}> · linked <t:${Math.floor(l.linked_at / 1000)}:R>`,
    )
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`Synced accounts (${all.length})`)
    .setDescription(body || '(none yet)')
    .setFooter({ text: `Page ${p}/${pages}` })
    .setColor(0x5865f2);

  const components =
    pages > 1
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`users:${p - 1}`)
              .setLabel('◀ Prev')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(p <= 1),
            new ButtonBuilder()
              .setCustomId(`users:${p + 1}`)
              .setLabel('Next ▶')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(p >= pages),
          ),
        ]
      : [];

  // ephemeral reply → only the caller sees it; parse:[] so the <@id>s never ping
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'You need the admin role to use this.', ...EPHEMERAL });
  }
  await interaction.reply({ ...render(1), ...EPHEMERAL });
}

/** Prev/Next button handler (customId "users:<page>"). Routed from index.js. */
export async function handleButton(interaction) {
  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'Admin role required.', ...EPHEMERAL });
  }
  const page = Number.parseInt(interaction.customId.split(':')[1], 10) || 1;
  await interaction.update(render(page));
}
