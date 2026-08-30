import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { config } from './config.js';
import { links, banState, banActions } from './db.js';
import { rcon, assertMcName, sanitizeReason } from './rcon.js';
import { parseBanlist } from './parsers.js';
import { audit, isAdmin, EPHEMERAL } from './rconCommand.js';
import { skinRenderUrl } from './mojang.js';

const GUARD_MIN = () => config.banSync.loopGuardMinutes;

/** True when the bot itself performed `action` on `mcName` recently (loop guard). */
function botJustDid(mcName, action) {
  return Boolean(banActions.recent(mcName, action, GUARD_MIN()));
}

// ---- primitive actions ------------------------------------------------

export async function banMinecraft({ mcName, reason }) {
  const name = assertMcName(mcName);
  const r = sanitizeReason(reason);
  await rcon.send(r ? `ban ${name} ${r}` : `ban ${name}`);
  await rcon.send(`kick ${name} ${r || 'Banned'}`).catch(() => {});
}

export async function pardonMinecraft({ mcName }) {
  const name = assertMcName(mcName);
  await rcon.send(`pardon ${name}`);
}

export async function banDiscord({ client, discordId, reason }) {
  const guild = await client.guilds.fetch(config.discord.guildId);
  await guild.bans.create(discordId, { reason: reason || 'Synced from Minecraft ban' });
}

export async function pardonDiscord({ client, discordId }) {
  const guild = await client.guilds.fetch(config.discord.guildId);
  await guild.bans.remove(discordId, 'Synced from Minecraft pardon').catch((err) => {
    if (err?.code !== 10026) throw err; // 10026 = Unknown Ban
  });
}

// ---- high level: admin /ban and /pardon -----------------------------

export async function banEverywhere({
  client,
  mcName,
  discordId,
  reason,
  initiatedBy,
  moderatorTag,
  mcOnly = false,
}) {
  const name = assertMcName(mcName);
  await banMinecraft({ mcName: name, reason });
  // record it either way so the poller's loop guard doesn't re-propose this ban
  banActions.record({ mcName: name, discordId, direction: 'd2m', action: 'ban', initiatedBy, reason });

  let discordResult;
  if (mcOnly) {
    discordResult = 'Discord left alone';
  } else if (!discordId) {
    discordResult = 'no linked Discord account';
  } else {
    try {
      await banDiscord({ client, discordId, reason: reason || `Banned by ${moderatorTag}` });
      discordResult = `banned <@${discordId}>`;
    } catch (err) {
      discordResult = `Discord ban failed: ${err.message}`;
    }
  }

  await audit(
    client,
    `⛔ **${moderatorTag}** banned \`${name}\`${mcOnly ? ' (Minecraft only)' : ''} — ${discordResult}` +
      `${reason ? ` — reason: ${reason}` : ''}`,
  );
  return { name, discordResult, mcOnly };
}

export async function pardonEverywhere({ client, mcName, discordId, initiatedBy, moderatorTag }) {
  const name = assertMcName(mcName);
  await pardonMinecraft({ mcName: name });
  banActions.record({ mcName: name, discordId, direction: 'd2m', action: 'pardon', initiatedBy });

  let discordResult = 'no linked Discord account';
  if (discordId) {
    try {
      await pardonDiscord({ client, discordId });
      discordResult = `unbanned <@${discordId}>`;
    } catch (err) {
      discordResult = `Discord unban failed: ${err.message}`;
    }
  }

  await audit(client, `♻️ **${moderatorTag}** pardoned \`${name}\` — ${discordResult}`);
  return { name, discordResult };
}

// ---- Discord -> Minecraft (gateway events) --------------------------

export function registerBanEvents(client) {
  client.on('guildBanAdd', async (ban) => {
    if (ban.guild.id !== config.discord.guildId) return;
    const link = links.getByDiscordId(ban.user.id);
    if (!link) {
      await audit(client, `ℹ️ ${ban.user.tag} was banned on Discord but has no linked Minecraft account.`);
      return;
    }
    if (botJustDid(link.mc_name, 'ban')) return; // we caused this ban ourselves

    try {
      await banMinecraft({ mcName: link.mc_name, reason: ban.reason || 'Banned on Discord' });
      banActions.record({
        mcName: link.mc_name,
        discordId: ban.user.id,
        direction: 'd2m',
        action: 'ban',
        initiatedBy: 'bot',
        reason: ban.reason ?? null,
      });
      await audit(client, `⛔ ${ban.user.tag} banned on Discord → \`${link.mc_name}\` banned on Minecraft.`);
    } catch (err) {
      await audit(client, `❌ Failed to ban \`${link.mc_name}\` on Minecraft: ${err.message}`);
    }
  });

  client.on('guildBanRemove', async (ban) => {
    if (ban.guild.id !== config.discord.guildId) return;
    const link = links.getByDiscordId(ban.user.id);
    if (!link) return;
    if (botJustDid(link.mc_name, 'pardon')) return;

    try {
      await pardonMinecraft({ mcName: link.mc_name });
      banActions.record({
        mcName: link.mc_name,
        discordId: ban.user.id,
        direction: 'd2m',
        action: 'pardon',
        initiatedBy: 'bot',
      });
      await audit(client, `♻️ ${ban.user.tag} unbanned on Discord → \`${link.mc_name}\` pardoned on Minecraft.`);
    } catch (err) {
      await audit(client, `❌ Failed to pardon \`${link.mc_name}\` on Minecraft: ${err.message}`);
    }
  });
}

// ---- Minecraft -> Discord (poller) ---------------------------------

let timer = null;

export function startBanPoller(client) {
  const tick = () => pollOnce(client).catch((err) => console.error('[bansync] poll error:', err.message));
  timer = setInterval(tick, config.banSync.intervalMs);
  if (timer.unref) timer.unref();
  // prime ban_state without firing actions on first run
  primeState().catch((err) => console.error('[bansync] prime error:', err.message));
}

export function stopBanPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function primeState() {
  if (banState.all().length > 0) return;
  const text = await rcon.send('banlist players').catch(() => rcon.send('banlist'));
  const { names } = parseBanlist(text);
  banState.replace(names);
  console.log(`[bansync] primed ban_state with ${names.length} existing ban(s)`);
}

async function pollOnce(client) {
  const text = await rcon.send('banlist players').catch(() => rcon.send('banlist'));
  const { names } = parseBanlist(text);
  const current = new Set(names.map((n) => n.toLowerCase()));
  const previous = new Set(banState.all().map((n) => n.toLowerCase()));

  const added = names.filter((n) => !previous.has(n.toLowerCase()));
  const removed = banState.all().filter((n) => !current.has(n.toLowerCase()));

  for (const name of added) {
    if (botJustDid(name, 'ban')) continue;
    await handleMinecraftBan(client, name);
  }
  for (const name of removed) {
    if (botJustDid(name, 'pardon')) continue;
    await handleMinecraftPardon(client, name);
  }

  banState.replace(names);
}

async function handleMinecraftBan(client, mcName) {
  const link = links.getByName(mcName);
  if (!link) {
    await audit(client, `ℹ️ \`${mcName}\` was banned on Minecraft (no linked Discord account).`);
    return;
  }
  banActions.record({
    mcName,
    discordId: link.discord_id,
    direction: 'm2d',
    action: 'ban',
    initiatedBy: 'poller',
  });

  if (config.banSync.mode === 'auto') {
    try {
      await banDiscord({ client, discordId: link.discord_id, reason: 'Banned on Minecraft' });
      await audit(client, `⛔ \`${mcName}\` banned on Minecraft → <@${link.discord_id}> banned on Discord.`);
    } catch (err) {
      await audit(client, `❌ Could not ban <@${link.discord_id}> on Discord: ${err.message}`);
    }
  } else {
    await proposeAction(client, {
      kind: 'ban',
      discordId: link.discord_id,
      mcName,
      description: `\`${mcName}\` was banned on Minecraft and is linked to <@${link.discord_id}>.`,
    });
  }
}

async function handleMinecraftPardon(client, mcName) {
  const link = links.getByName(mcName);
  if (!link) return;
  banActions.record({
    mcName,
    discordId: link.discord_id,
    direction: 'm2d',
    action: 'pardon',
    initiatedBy: 'poller',
  });

  if (config.banSync.mode === 'auto') {
    try {
      await pardonDiscord({ client, discordId: link.discord_id });
      await audit(client, `♻️ \`${mcName}\` pardoned on Minecraft → <@${link.discord_id}> unbanned on Discord.`);
    } catch (err) {
      await audit(client, `❌ Could not unban <@${link.discord_id}> on Discord: ${err.message}`);
    }
  } else {
    await proposeAction(client, {
      kind: 'unban',
      discordId: link.discord_id,
      mcName,
      description: `\`${mcName}\` was pardoned on Minecraft and is linked to <@${link.discord_id}>.`,
    });
  }
}

async function proposeAction(client, { kind, discordId, mcName, description }) {
  const channel = await client.channels.fetch(config.discord.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(kind === 'ban' ? 'Minecraft ban detected' : 'Minecraft pardon detected')
    .setDescription(`${description}\n\nApply the same action on Discord?`)
    .setThumbnail(skinRenderUrl(mcName))
    .setColor(kind === 'ban' ? 0xcc3333 : 0x33aa55);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bansync:${kind}:${discordId}:${mcName}`)
      .setLabel(kind === 'ban' ? 'Ban on Discord' : 'Unban on Discord')
      .setStyle(kind === 'ban' ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bansync:ignore:${discordId}:${mcName}`)
      .setLabel('Ignore')
      .setStyle(ButtonStyle.Secondary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

/** Handle the buttons produced by proposeAction(). Called from interactionCreate. */
export async function handleBanSyncButton(interaction) {
  const [, kind, discordId] = interaction.customId.split(':');
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Admin role required.', ...EPHEMERAL });
    return;
  }

  if (kind === 'ignore') {
    await interaction.update({ content: 'Ignored.', embeds: [], components: [] });
    return;
  }

  try {
    if (kind === 'ban') {
      await banDiscord({ client: interaction.client, discordId, reason: 'Banned on Minecraft (confirmed)' });
      await interaction.update({ content: `⛔ Banned <@${discordId}> on Discord.`, embeds: [], components: [] });
    } else if (kind === 'unban') {
      await pardonDiscord({ client: interaction.client, discordId });
      await interaction.update({ content: `♻️ Unbanned <@${discordId}> on Discord.`, embeds: [], components: [] });
    }
  } catch (err) {
    await interaction.update({
      content: `❌ Action failed: ${err.message}`,
      embeds: [],
      components: [],
    });
  }
}
