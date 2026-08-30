import { SlashCommandBuilder } from 'discord.js';
import { isAdmin, audit, EPHEMERAL } from '../rconCommand.js';
import { isLinkingOpen, setLinkingOpen } from '../state.js';

export const adminOnly = true;

export const data = new SlashCommandBuilder()
  .setName('linking')
  .setDescription('Open or close new /link sign-ups')
  .addSubcommand((s) => s.setName('status').setDescription('Show whether /link is currently open'))
  .addSubcommand((s) => s.setName('open').setDescription('Admin: let players use /link again'))
  .addSubcommand((s) => s.setName('close').setDescription('Admin: stop new players from using /link'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    return void interaction.reply({
      content: isLinkingOpen()
        ? '🟢 Linking is **open** — players can use `/link`.'
        : '🔴 Linking is **closed** — new `/link` attempts are refused.',
      ...EPHEMERAL,
    });
  }

  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'You need the admin role to use this.', ...EPHEMERAL });
  }

  const open = sub === 'open';
  setLinkingOpen(open);

  await interaction.reply({
    content: open
      ? '🟢 Linking is now **open**.'
      : '🔴 Linking is now **closed**. Existing links are unaffected, and `/forcelink` still works.',
    ...EPHEMERAL,
  });
  await audit(
    interaction.client,
    `${open ? '🟢' : '🔴'} ${interaction.user.tag} ${open ? 'opened' : 'closed'} \`/link\` sign-ups.`,
  );
}
