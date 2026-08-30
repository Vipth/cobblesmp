import { SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import { rcon } from '../rcon.js';
import { parseList } from '../parsers.js';

export const data = new SlashCommandBuilder()
  .setName('list')
  .setDescription('Show who is online on the server');

export async function execute(interaction) {
  await interaction.deferReply();
  let text;
  try {
    text = await rcon.send('list');
  } catch (err) {
    return void interaction.editReply(`❌ Could not reach the server: ${err.message}`);
  }

  const { online, max, players } = parseList(text);
  if (!online) return void interaction.editReply('Nobody is online right now.');

  const count = `${online}${max ? `/${max}` : ''}`;
  const names = players.length ? players.map(escapeMarkdown).join(', ') : text.trim();
  await interaction.editReply(`**${count} online:** ${names}`);
}
