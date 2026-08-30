import { SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { sanitizeChatMessage } from '../rcon.js';
import { ampToComponents } from '../mctext.js';
import { runAdminRcon } from '../rconCommand.js';

// Minecraft named colours, brightest-first for a sensible dropdown order.
const COLOR_CHOICES = [
  'white', 'yellow', 'gold', 'red', 'dark_red', 'green', 'dark_green',
  'aqua', 'dark_aqua', 'blue', 'dark_blue', 'light_purple', 'dark_purple',
  'gray', 'dark_gray', 'black',
].map((c) => ({ name: c.replace(/_/g, ' '), value: c }));

export const adminOnly = true;

export const data = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Broadcast a message in the server chat')
  .addStringOption((o) =>
    o.setName('message').setDescription('Message to broadcast').setRequired(true).setMaxLength(230),
  )
  .addStringOption((o) =>
    o
      .setName('color')
      .setDescription('Message colour (default: white)')
      .addChoices(...COLOR_CHOICES),
  )
  .addBooleanOption((o) => o.setName('bold').setDescription('Bold the message'));

export async function execute(interaction) {
  await runAdminRcon(interaction, {
    build: () => {
      const msg = sanitizeChatMessage(interaction.options.getString('message', true));
      const color = interaction.options.getString('color') ?? config.sayDefaultColor;
      const bold = interaction.options.getBoolean('bold') ?? false;

      // vanilla `say` over RCON renders as "[Rcon] <msg>"; tellraw controls the whole line
      const payload = JSON.stringify([
        ...ampToComponents(config.sayPrefix, config.sayPrefixColor),
        { text: ' ', color: 'white' },
        { text: msg, color, bold },
      ]);
      return { command: `tellraw @a ${payload}`, summary: `broadcast (${color}): ${msg}` };
    },
  });
}
