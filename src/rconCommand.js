import { MessageFlags } from 'discord.js';
import { config } from './config.js';
import { links } from './db.js';
import { rcon, assertMcName, ValidationError } from './rcon.js';

export const EPHEMERAL = { flags: MessageFlags.Ephemeral };

/**
 * Shared helpers for the admin RCON commands.
 *
 * Flow for every admin command:
 *   isAdmin() -> resolveTarget()/validate typed options -> build RCON string
 *   -> rcon.send() -> reply -> audit()
 */

/**
 * Admin gate. Access is granted ONLY to members holding `ADMIN_ROLE_ID`.
 * The guild owner is also allowed as an un-loseable failsafe (so a wrong
 * `ADMIN_ROLE_ID` can't lock everyone out). Discord's global "Administrator"
 * permission is deliberately NOT a bypass — the role is the whole gate.
 */
export function isAdmin(interaction) {
  if (!interaction.inGuild()) return false;
  if (interaction.guildId !== config.discord.guildId) return false;

  if (interaction.guild?.ownerId && interaction.guild.ownerId === interaction.user.id) {
    return true;
  }

  const roles = interaction.member?.roles;
  if (roles?.cache) return roles.cache.has(config.discord.adminRoleId); // GuildMember
  if (Array.isArray(roles)) return roles.includes(config.discord.adminRoleId); // raw API member
  return false;
}

const MENTION_RE = /^<@!?(\d+)>$/;
const ID_RE = /^\d{15,20}$/;

/**
 * Resolve a free-form target string that may be a Discord mention / id or a raw
 * Minecraft username.
 *
 * @returns {{ mcName: string, discordId: string|null, viaLink: boolean }}
 */
export function resolveTarget(raw) {
  const value = String(raw ?? '').trim();
  const mention = value.match(MENTION_RE);
  const discordId = mention ? mention[1] : ID_RE.test(value) ? value : null;

  if (discordId) {
    const link = links.getByDiscordId(discordId);
    if (!link) {
      throw new ValidationError(
        `<@${discordId}> has not linked a Minecraft account (\`/link\`), so I don't know their username.`,
      );
    }
    return { mcName: link.mc_name, discordId, viaLink: true };
  }

  const mcName = assertMcName(value);
  const link = links.getByName(mcName);
  return { mcName, discordId: link?.discord_id ?? null, viaLink: Boolean(link) };
}

/** Post a line to the audit / log channel. Never throws. */
export async function audit(client, content) {
  try {
    const channel = await client.channels.fetch(config.discord.logChannelId);
    if (channel?.isTextBased()) await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[audit] could not post to log channel:', err.message);
  }
}

/** ```-fenced, length-capped block for showing raw RCON output back to Discord. */
export function formatRconOutput(text) {
  const clean = String(text ?? '').trim() || '(no output)';
  const capped = clean.length > 1800 ? `${clean.slice(0, 1800)}\n… (truncated)` : clean;
  return '```\n' + capped.replace(/```/g, "`​``") + '\n```';
}

/**
 * Standard wrapper for an admin command that runs a single RCON command.
 *
 * @param interaction discord.js ChatInputCommandInteraction (already deferred or not)
 * @param opts.build  () => { command: string, summary: string }  (may throw ValidationError)
 */
export async function runAdminRcon(interaction, { build }) {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: 'You need the admin role to use this command.',
      ...EPHEMERAL,
    });
    return;
  }

  let command;
  let summary;
  try {
    ({ command, summary } = build());
  } catch (err) {
    if (err instanceof ValidationError) {
      await interaction.reply({ content: `⚠️ ${err.message}`, ...EPHEMERAL });
      return;
    }
    throw err;
  }

  await interaction.deferReply(EPHEMERAL);

  let output;
  try {
    output = await rcon.send(command);
  } catch (err) {
    await interaction.editReply(`❌ RCON error: ${err.message}`);
    await audit(
      interaction.client,
      `❌ ${userTag(interaction)} ran \`${command}\` — RCON error: ${err.message}`,
    );
    return;
  }

  await interaction.editReply(`✅ \`${command}\`\n${formatRconOutput(output)}`);
  await audit(interaction.client, `🔧 ${userTag(interaction)} — ${summary}\n> \`${command}\``);
}

export function userTag(interaction) {
  return `${interaction.user.tag} (<@${interaction.user.id}>)`;
}
