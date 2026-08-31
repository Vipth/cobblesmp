import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { feedbackClaims, feedbackPosts, links } from '../db.js';
import { parseRewardLines } from '../feedbackParsers.js';
import { deliverReward } from '../feedbackRewards.js';
import { isAdmin, audit, userTag, EPHEMERAL } from '../rconCommand.js';
import { isOnline } from '../serverquery.js';
import { clearFeedbackChannel, getFeedbackChannel, setFeedbackChannel } from '../state.js';

export const adminOnly = true;

export const data = new SlashCommandBuilder()
  .setName('feedback')
  .setDescription('Post a feedback request, review results, or manage settings')
  .addSubcommand((s) =>
    s
      .setName('post')
      .setDescription('Post a new feedback request, optionally with claimable rewards')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post in (saved as the default for next time)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((s) =>
    s.setName('reset-channel').setDescription('Clear the saved feedback channel (no post is made)'),
  )
  .addSubcommand((s) =>
    s
      .setName('results')
      .setDescription('Show vote and reward-claim results for a feedback post')
      .addStringOption((o) =>
        o
          .setName('message')
          .setDescription('The feedback post: its message link or raw message ID')
          .setRequired(true),
      ),
  );

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'You need the admin role to use this.', ...EPHEMERAL });
  }
  if (!config.feedback.enabled) {
    return void interaction.reply({
      content: '⚠️ Feedback rewards are disabled (set `FEEDBACK_REWARDS_ENABLED=true` in `.env`).',
      ...EPHEMERAL,
    });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'reset-channel') {
    clearFeedbackChannel();
    return void interaction.reply({ content: '✅ Cleared the saved feedback channel.', ...EPHEMERAL });
  }

  if (sub === 'results') {
    return void showResults(interaction);
  }

  const channelOption = interaction.options.getChannel('channel');
  let channelId;
  if (channelOption) {
    channelId = channelOption.id;
    setFeedbackChannel(channelId);
  } else {
    channelId = getFeedbackChannel() || config.feedback.channelId || null;
  }
  if (!channelId) {
    return void interaction.reply({
      content:
        '⚠️ No feedback channel configured. Pass `channel:`, or set `FEEDBACK_CHANNEL_ID` in `.env`.',
      ...EPHEMERAL,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`feedback:${channelId}`)
    .setTitle('New feedback request')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Feedback message')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rewards')
          .setLabel('Rewards, one per line (optional)')
          .setPlaceholder("3 minecraft:apple\ncmd:Thor's Hammer|thorshammer give {player} 1")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(2000),
      ),
    );

  await interaction.showModal(modal);
}

async function showResults(interaction) {
  const raw = interaction.options.getString('message', true);
  const messageId = extractMessageId(raw);

  const post = feedbackPosts.get(messageId);
  if (!post) {
    return void interaction.reply({ content: `⚠️ No feedback post found for \`${raw}\`.`, ...EPHEMERAL });
  }

  const claims = feedbackClaims.forPost(post.message_id);
  const up = claims.filter((c) => c.sentiment === 'up').length;
  const down = claims.filter((c) => c.sentiment === 'down').length;

  const embed = new EmbedBuilder()
    .setTitle('Feedback results')
    .setURL(`https://discord.com/channels/${interaction.guildId}/${post.channel_id}/${post.message_id}`)
    .setDescription(post.message.length > 200 ? `${post.message.slice(0, 200)}…` : post.message)
    .setColor(0x5865f2)
    .addFields(
      { name: 'Votes', value: `⬆️ ${up}   ⬇️ ${down}   (${claims.length} total)` },
      { name: 'Posted by', value: `<@${post.author_id}>`, inline: true },
      { name: 'Posted', value: `<t:${Math.floor(post.created_at / 1000)}:R>`, inline: true },
    );

  if (post.rewards.length > 0) {
    const rewardClaims = claims.filter((c) => c.status !== 'no_reward');
    const delivered = rewardClaims.filter((c) => c.status === 'delivered').length;
    const queued = rewardClaims.filter((c) => c.status === 'queued').length;

    const byReward = new Map();
    for (const c of rewardClaims) byReward.set(c.reward_label, (byReward.get(c.reward_label) ?? 0) + 1);
    const rewardLines = post.rewards
      .map((r) => `${r.label}: ${byReward.get(r.label) ?? 0}`)
      .join('\n');

    embed.addFields(
      {
        name: 'Rewards claimed',
        value: `${rewardClaims.length} total — ${delivered} delivered, ${queued} queued for delivery`,
      },
      { name: 'By reward', value: rewardLines || '_none_' },
    );
  }

  await interaction.reply({ embeds: [embed], ...EPHEMERAL });
}

/** Accept either a raw message id or a full Discord message link and return the trailing id. */
function extractMessageId(raw) {
  const s = String(raw ?? '').trim();
  const match = s.match(/(\d{15,20})\/?$/);
  return match ? match[1] : s;
}

export async function handleModal(interaction) {
  if (interaction.customId.split(':')[0] !== 'feedback') return;

  if (!isAdmin(interaction)) {
    return void interaction.reply({ content: 'You need the admin role to use this.', ...EPHEMERAL });
  }
  if (!config.feedback.enabled) {
    return void interaction.reply({ content: '⚠️ Feedback rewards are disabled.', ...EPHEMERAL });
  }

  const channelId = interaction.customId.split(':')[1];
  const message = interaction.fields.getTextInputValue('message');
  const rewardsRaw = interaction.fields.getTextInputValue('rewards') ?? '';

  const { rewards, error } = parseRewardLines(rewardsRaw);
  if (error) {
    return void interaction.reply({
      content: `⚠️ Line ${error.line} (\`${error.raw}\`): ${error.message}`,
      ...EPHEMERAL,
    });
  }

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return void interaction.reply({
      content: '⚠️ That channel is no longer usable — run `/feedback` again with a valid channel.',
      ...EPHEMERAL,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('We want your feedback!')
    .setDescription(message)
    .setColor(0x5865f2)
    .setFooter({
      text: rewards.length
        ? `React below — ${rewards.length} reward${rewards.length === 1 ? '' : 's'} available`
        : 'React below to let us know what you think',
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('feedback:vote:up').setEmoji('⬆️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('feedback:vote:down').setEmoji('⬇️').setStyle(ButtonStyle.Danger),
  );

  const sent = await channel.send({ embeds: [embed], components: [row] });

  feedbackPosts.create({
    messageId: sent.id,
    channelId: channel.id,
    authorId: interaction.user.id,
    message,
    rewards,
  });

  await interaction.reply({ content: `✅ Posted to <#${channel.id}>.`, ...EPHEMERAL });
  await audit(
    interaction.client,
    `📋 ${userTag(interaction)} posted a feedback request in <#${channel.id}> (${rewards.length} reward option(s)).`,
  );
}

export async function handleButton(interaction) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== 'feedback' || parts[1] !== 'vote') return;
  const sentiment = parts[2];

  if (!config.feedback.enabled) {
    return void interaction.reply({ content: 'Feedback rewards are currently disabled.', ...EPHEMERAL });
  }

  const post = feedbackPosts.get(interaction.message.id);
  if (!post) {
    return void interaction.reply({ content: 'This feedback post is no longer tracked.', ...EPHEMERAL });
  }

  const existing = feedbackClaims.get(post.message_id, interaction.user.id);
  if (existing) {
    return void interaction.reply({ content: describeExistingClaim(existing), ...EPHEMERAL });
  }

  if (post.rewards.length === 0) {
    try {
      feedbackClaims.create({
        postId: post.message_id,
        discordId: interaction.user.id,
        sentiment,
        status: 'no_reward',
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    return void interaction.reply({ content: '🙏 Thanks for your feedback!', ...EPHEMERAL });
  }

  const link = links.getByDiscordId(interaction.user.id);
  if (!link) {
    return void interaction.reply({
      content:
        '⚠️ Link your Minecraft account with `/link` first, then click this button again to claim a reward.',
      ...EPHEMERAL,
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`feedback:pick:${post.message_id}:${sentiment}`)
    .setPlaceholder('Choose your reward')
    .addOptions(
      post.rewards.map((r, i) =>
        new StringSelectMenuOptionBuilder().setLabel(r.label.slice(0, 100)).setValue(String(i)),
      ),
    );

  await interaction.reply({
    content: '🙏 Thanks for your feedback! Pick a reward:',
    components: [new ActionRowBuilder().addComponents(menu)],
    ...EPHEMERAL,
  });
}

export async function handleSelectMenu(interaction) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== 'feedback' || parts[1] !== 'pick') return;
  const [, , postId, sentiment] = parts;

  if (!config.feedback.enabled) {
    return void interaction.update({ content: 'Feedback rewards are currently disabled.', components: [] });
  }

  const post = feedbackPosts.get(postId);
  if (!post) {
    return void interaction.update({ content: 'This feedback post is no longer tracked.', components: [] });
  }

  const link = links.getByDiscordId(interaction.user.id);
  if (!link) {
    return void interaction.update({
      content: '⚠️ Your account is no longer linked — run `/link` and click the vote button again.',
      components: [],
    });
  }

  const idx = Number(interaction.values[0]);
  const reward = post.rewards[idx];
  if (!reward) {
    return void interaction.update({ content: '⚠️ That reward option is no longer valid.', components: [] });
  }

  const online = await isOnline(link.mc_name);

  let claim;
  try {
    claim = feedbackClaims.create({
      postId: post.message_id,
      discordId: interaction.user.id,
      mcUuid: link.mc_uuid,
      sentiment,
      rewardLabel: reward.label,
      commandTemplate: reward.commandTemplate,
      wasOnline: online === true,
      status: 'queued',
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return void interaction.update({
        content: 'You already claimed a reward for this feedback post.',
        components: [],
      });
    }
    throw err;
  }

  if (online === true) {
    try {
      await deliverReward(
        interaction.client,
        { id: claim.lastInsertRowid, discord_id: interaction.user.id, command_template: reward.commandTemplate },
        link.mc_name,
      );
      await interaction.update({ content: `🎁 Claimed **${reward.label}** — delivered now!`, components: [] });
      return;
    } catch (err) {
      console.error('[feedback] immediate delivery failed, leaving queued:', err.message);
      // falls through — claim stays 'queued', the delivery poller will retry
    }
  }

  await interaction.update({
    content: `🎁 Claimed **${reward.label}** — you'll receive it the next time you're online.`,
    components: [],
  });
  await audit(
    interaction.client,
    `🎁 <@${interaction.user.id}> (\`${link.mc_name}\`) claimed "${reward.label}" for feedback post \`${post.message_id}\` — queued for delivery.`,
  );
}

function describeExistingClaim(claim) {
  if (claim.status === 'no_reward') return 'You already gave feedback on this post — thanks!';
  if (claim.status === 'delivered') return `You already claimed **${claim.reward_label}** — delivered.`;
  return `You already claimed **${claim.reward_label}** — queued for delivery.`;
}

function isUniqueViolation(err) {
  return err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}
