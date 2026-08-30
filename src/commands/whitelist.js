import { SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import { assertMcName } from '../rcon.js';
import { isAdmin, runAdminRcon, EPHEMERAL } from '../rconCommand.js';
import { reconcileWhitelist } from '../whitelist.js';

export const adminOnly = true;

export const data = new SlashCommandBuilder()
  .setName('whitelist')
  .setDescription('Manage the server whitelist')
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add a player to the whitelist')
      .addStringOption((o) =>
        o.setName('username').setDescription('Minecraft username').setRequired(true).setMaxLength(16),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove a player from the whitelist')
      .addStringOption((o) =>
        o.setName('username').setDescription('Minecraft username').setRequired(true).setMaxLength(16),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Show the current whitelist'))
  .addSubcommand((s) =>
    s.setName('sync').setDescription('Reconcile the whitelist with linked accounts right now'),
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'sync') {
    if (!isAdmin(interaction)) {
      return void interaction.reply({
        content: 'You need the admin role to use this.',
        ...EPHEMERAL,
      });
    }
    await interaction.deferReply(EPHEMERAL);
    try {
      const r = await reconcileWhitelist(interaction.client);
      if (r.skipped) {
        return void interaction.editReply(
          `Nothing to do — ${r.skipped}. Set \`WHITELIST_MODE\` to \`additive\` or \`strict\` to enable enforcement.`,
        );
      }
      const names = (arr) => arr.map(escapeMarkdown).join(', ');
      const lines = [
        `✅ Synced — server whitelist: ${r.serverCount}, linked: ${r.linkedCount}`,
        `added: ${r.added.length ? names(r.added) : 'none'}`,
      ];
      if (r.removed.length) lines.push(`removed: ${names(r.removed)}`);
      if (r.reported.length) lines.push(`unlinked (still allowed): ${names(r.reported)}`);
      await interaction.editReply(lines.join('\n'));
    } catch (err) {
      await interaction.editReply(`❌ Sync failed: ${err.message}`);
    }
    return;
  }

  await runAdminRcon(interaction, {
    build: () => {
      if (sub === 'list') return { command: 'whitelist list', summary: 'listed the whitelist' };
      const name = assertMcName(interaction.options.getString('username', true));
      return { command: `whitelist ${sub} ${name}`, summary: `whitelist ${sub} ${name}` };
    },
  });
}
