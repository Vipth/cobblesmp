import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} from 'discord.js';
import { config } from './config.js';
import { closeDb } from './db.js';
import { rcon } from './rcon.js';
import { loadCommands } from './commands/index.js';
import { audit } from './rconCommand.js';
import {
  handleBanSyncButton,
  registerBanEvents,
  startBanPoller,
  stopBanPoller,
} from './bansync.js';
import { startWhitelistReconciler, stopWhitelistReconciler } from './whitelist.js';
import { startRoleReconciler, stopRoleReconciler, linkedRoleEnabled } from './roles.js';
import { startPresencePoller, stopPresencePoller } from './presence.js';
import { isLinkingOpen } from './state.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration],
});

const commands = await loadCommands();

rcon.onUnhealthy = (message) => audit(client, `⚠️ ${message}`);

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] logged in as ${c.user.tag}`);

  if (config.deployCommandsOnStart) {
    const rest = new REST().setToken(config.discord.token);
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: [...commands.values()].map((cmd) => cmd.data.toJSON()) },
    );
    console.log('[bot] slash commands registered on start');
  }

  await checkAdminRole(client);
  await checkLinkedRole(client);
  await checkPresenceChannel(client);

  registerBanEvents(client);
  startBanPoller(client);
  startWhitelistReconciler(client);
  startRoleReconciler(client);
  startPresencePoller(client);
  await audit(
    client,
    `✅ Bot online. Linking is ${isLinkingOpen() ? '🟢 open' : '🔴 closed'}.`,
  );
});

/** Warn loudly if ADMIN_ROLE_ID doesn't resolve to a real role in the guild. */
async function checkAdminRole(client) {
  const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
  if (!guild) {
    console.warn(`[bot] not a member of guild ${config.discord.guildId}?`);
    return;
  }
  await guild.roles.fetch().catch(() => {});
  const role = guild.roles.cache.get(config.discord.adminRoleId);
  if (role) {
    console.log(`[bot] admin role: @${role.name} (${config.discord.adminRoleId})`);
  } else {
    const msg =
      `⚠️ ADMIN_ROLE_ID (\`${config.discord.adminRoleId}\`) is not a role in this server. ` +
      `Admin commands (/ban, /forcelink, …) will only work for the server owner until this is fixed in \`.env\`.`;
    console.warn(`[bot] ${msg}`);
    await audit(client, msg);
  }
}

/** Validate LINKED_ROLE_ID (if set) exists and the bot can actually assign it. */
async function checkLinkedRole(client) {
  if (!linkedRoleEnabled()) return;
  const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
  if (!guild) return;
  await guild.roles.fetch().catch(() => {});
  const role = guild.roles.cache.get(config.discord.linkedRoleId);
  if (!role) {
    await audit(
      client,
      `⚠️ LINKED_ROLE_ID (\`${config.discord.linkedRoleId}\`) is not a role in this server — linked-role sync is effectively off.`,
    );
    return;
  }
  const me = await guild.members.fetchMe().catch(() => null);
  if (me && !me.permissions.has('ManageRoles')) {
    await audit(client, `⚠️ I need the **Manage Roles** permission to assign @${role.name}.`);
  } else if (me && role.position >= me.roles.highest.position) {
    await audit(
      client,
      `⚠️ @${role.name} sits above my highest role — move it below me or I can't assign it.`,
    );
  } else {
    console.log(`[bot] linked role: @${role.name} (${config.discord.linkedRoleId})`);
  }
}

/** If the presence feed is configured, warn when its channel is unusable. */
async function checkPresenceChannel(client) {
  if (!config.presence.enabled || !config.presence.channelId) return;
  const ch = await client.channels.fetch(config.presence.channelId).catch(() => null);
  if (!ch?.isTextBased()) {
    await audit(
      client,
      `⚠️ PRESENCE_CHANNEL_ID (\`${config.presence.channelId}\`) is not a text channel I can post in — join/leave feed disabled (playtime still tracked).`,
    );
  } else {
    console.log(`[bot] presence feed channel: #${ch.name ?? ch.id}`);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('bansync:')) {
        await handleBanSyncButton(interaction);
        return;
      }
      // route "<commandName>:..." button ids to that command's handleButton()
      const owner = commands.get(interaction.customId.split(':')[0]);
      if (owner?.handleButton) await owner.handleButton(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  } catch (err) {
    console.error(
      `[interaction] ${interaction.commandName ?? interaction.customId ?? 'unknown'}:`,
      err,
    );
    const content = `❌ Something went wrong: ${err.message}`;
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    } catch {
      /* interaction already gone */
    }
  }
});

client.on(Events.Error, (err) => console.error('[discord] client error:', err));

await client.login(config.discord.token);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[bot] ${signal} received, shutting down…`);
  stopBanPoller();
  stopWhitelistReconciler();
  stopRoleReconciler();
  stopPresencePoller();
  try {
    await audit(client, '🛑 Bot shutting down.');
  } catch {
    /* ignore */
  }
  client.destroy();
  await rcon.close();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
