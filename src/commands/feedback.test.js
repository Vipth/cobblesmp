import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Force a known config before config.js loads (same convention as rconCommand.test.js).
process.env.DISCORD_TOKEN = 'x';
process.env.DISCORD_CLIENT_ID = '1';
process.env.GUILD_ID = 'G';
process.env.ADMIN_ROLE_ID = 'ROLE';
process.env.LOG_CHANNEL_ID = 'LOGCHAN';
process.env.RCON_PASSWORD = 'x';
process.env.DATABASE_PATH = ':memory:';
process.env.FEEDBACK_REWARDS_ENABLED = 'true';

const { config } = await import('../config.js');
const { rcon } = await import('../rcon.js');
const { links, feedbackClaims, feedbackPosts } = await import('../db.js');
const { execute, handleModal, handleButton, handleSelectMenu } = await import('./feedback.js');
const { deliverReward } = await import('../feedbackRewards.js');
const { getFeedbackChannel } = await import('../state.js');

// ---- fake RCON: never opens a socket, drives `isOnline()` via a controlled `list` reply ----

let sentCommands = [];
let onlineNames = new Set();
let failCommandSubstring = null;

mock.method(rcon, 'send', async (command) => {
  sentCommands.push(command);
  if (failCommandSubstring && command.includes(failCommandSubstring)) {
    throw new Error('simulated RCON failure');
  }
  if (command === 'list') {
    const names = [...onlineNames];
    return `There are ${names.length} of a max of 20 players online: ${names.join(', ')}`;
  }
  return `[test] ${command}`;
});

// serverquery.js caches `list` for 20s — fake the clock so each test can force a fresh read.
mock.timers.enable({ apis: ['Date'] });
function freshOnlineRead() {
  mock.timers.tick(21_000);
}

function resetRcon({ online = [] } = {}) {
  sentCommands = [];
  onlineNames = new Set(online);
  failCommandSubstring = null;
  freshOnlineRead();
}

// ---- fake discord.js client / channels ----

let msgCounter = 0;
function makeFakeClient() {
  const channels = new Map();
  return {
    channels: {
      fetch: async (id) => {
        if (!channels.has(id)) {
          const chan = {
            id,
            sentMessages: [],
            sentIds: [],
            isTextBased: () => true,
            send: async (payload) => {
              const msgId = `msg-${msgCounter++}`;
              chan.sentMessages.push(payload);
              chan.sentIds.push(msgId);
              return { id: msgId };
            },
          };
          channels.set(id, chan);
        }
        return channels.get(id);
      },
    },
    _channels: channels,
  };
}

// ---- fake interaction factories ----

function guildBits({ userId, admin }) {
  return {
    inGuild: () => true,
    guildId: 'G',
    guild: { ownerId: 'OWNER' },
    user: { id: userId, tag: `${userId}#0001` },
    member: { roles: { cache: new Set(admin ? ['ROLE'] : []) } },
  };
}

function mkCommandInteraction({
  userId = 'ADMIN1',
  admin = true,
  subcommand = 'post',
  channelOption = null,
  messageOption = null,
  client,
}) {
  const replies = [];
  const modals = [];
  return {
    ...guildBits({ userId, admin }),
    options: {
      getSubcommand: () => subcommand,
      getChannel: (name) => (name === 'channel' ? channelOption : null),
      getString: (name) => (name === 'message' ? messageOption : null),
    },
    reply: async (payload) => void replies.push(payload),
    showModal: async (modal) => void modals.push(modal),
    client,
    _replies: replies,
    _modals: modals,
  };
}

function mkModalInteraction({ userId = 'ADMIN1', admin = true, channelId, message, rewards, client }) {
  const replies = [];
  return {
    ...guildBits({ userId, admin }),
    customId: `feedback:${channelId}`,
    fields: { getTextInputValue: (name) => (name === 'message' ? message : rewards ?? '') },
    reply: async (payload) => void replies.push(payload),
    client,
    _replies: replies,
  };
}

function mkButtonInteraction({ userId, sentiment = 'up', messageId, client }) {
  const replies = [];
  return {
    customId: `feedback:vote:${sentiment}`,
    message: { id: messageId },
    user: { id: userId },
    reply: async (payload) => void replies.push(payload),
    client,
    _replies: replies,
  };
}

function mkSelectInteraction({ userId, postId, sentiment = 'up', valueIndex, client }) {
  const updates = [];
  return {
    customId: `feedback:pick:${postId}:${sentiment}`,
    values: [String(valueIndex)],
    user: { id: userId },
    update: async (payload) => void updates.push(payload),
    client,
    _updates: updates,
  };
}

const REWARDS_TEXT = "3 minecraft:apple\ncmd:Thor's Hammer|thorshammer give {player} 1";

// ================= execute =================

test('execute: no channel configured anywhere -> ephemeral error, no modal', async () => {
  const client = makeFakeClient();
  const i = mkCommandInteraction({ client });
  await execute(i);
  assert.equal(i._modals.length, 0);
  assert.match(i._replies[0].content, /No feedback channel configured/);
});

test('execute: explicit channel option opens the modal and saves the channel as default', async () => {
  const client = makeFakeClient();
  const i = mkCommandInteraction({ channelOption: { id: 'CHAN-A' }, client });
  await execute(i);
  assert.equal(i._modals.length, 1);
  assert.equal(i._modals[0].toJSON().custom_id, 'feedback:CHAN-A');
  assert.equal(getFeedbackChannel(), 'CHAN-A');
});

test('execute: reset-channel clears the saved channel without opening a modal', async () => {
  const client = makeFakeClient();
  const i = mkCommandInteraction({ subcommand: 'reset-channel', client });
  await execute(i);
  assert.equal(i._modals.length, 0);
  assert.equal(getFeedbackChannel(), null);
  assert.match(i._replies[0].content, /Cleared the saved feedback channel/);
});

test('execute: non-admin is refused', async () => {
  const client = makeFakeClient();
  const i = mkCommandInteraction({ admin: false, channelOption: { id: 'CHAN-A' }, client });
  await execute(i);
  assert.equal(i._modals.length, 0);
  assert.match(i._replies[0].content, /admin role/);
});

test('execute: feature disabled refuses even for an admin with a channel', async () => {
  config.feedback.enabled = false;
  try {
    const client = makeFakeClient();
    const i = mkCommandInteraction({ channelOption: { id: 'CHAN-A' }, client });
    await execute(i);
    assert.equal(i._modals.length, 0);
    assert.match(i._replies[0].content, /disabled/);
  } finally {
    config.feedback.enabled = true;
  }
});

test('execute: results for an unknown message -> ephemeral "not found"', async () => {
  const client = makeFakeClient();
  const i = mkCommandInteraction({ subcommand: 'results', messageOption: 'no-such-post', client });
  await execute(i);
  assert.match(i._replies[0].content, /No feedback post found/);
});

test('execute: results summarizes votes and reward claims', async () => {
  feedbackPosts.create({
    messageId: 'post-results-1',
    channelId: 'CHAN-C',
    authorId: 'ADMIN1',
    message: 'How are we doing?',
    rewards: [
      { label: '3× minecraft:apple', commandTemplate: 'give {player} minecraft:apple 3' },
      { label: "Thor's Hammer", commandTemplate: 'thorshammer give {player} 1' },
    ],
  });
  feedbackClaims.create({ postId: 'post-results-1', discordId: 'R-UP-1', sentiment: 'up', status: 'no_reward' });
  feedbackClaims.create({ postId: 'post-results-1', discordId: 'R-UP-2', sentiment: 'up', status: 'no_reward' });
  feedbackClaims.create({ postId: 'post-results-1', discordId: 'R-DOWN-1', sentiment: 'down', status: 'no_reward' });
  feedbackClaims.create({
    postId: 'post-results-1',
    discordId: 'R-CLAIM-1',
    mcUuid: 'uuid-r1',
    sentiment: 'up',
    rewardLabel: '3× minecraft:apple',
    commandTemplate: 'give {player} minecraft:apple 3',
    wasOnline: true,
    status: 'delivered',
    deliveredAt: Date.now(),
  });
  feedbackClaims.create({
    postId: 'post-results-1',
    discordId: 'R-CLAIM-2',
    mcUuid: 'uuid-r2',
    sentiment: 'down',
    rewardLabel: "Thor's Hammer",
    commandTemplate: 'thorshammer give {player} 1',
    wasOnline: false,
    status: 'queued',
  });

  const client = makeFakeClient();
  const i = mkCommandInteraction({ subcommand: 'results', messageOption: 'post-results-1', client });
  await execute(i);

  const embed = i._replies[0].embeds[0].data;
  const field = (name) => embed.fields.find((f) => f.name === name).value;
  assert.match(field('Votes'), /⬆️ 3/);
  assert.match(field('Votes'), /⬇️ 2/);
  assert.match(field('Votes'), /5 total/);
  assert.match(field('Rewards claimed'), /2 total/);
  assert.match(field('Rewards claimed'), /1 delivered/);
  assert.match(field('Rewards claimed'), /1 queued/);
  assert.match(field('By reward'), /3× minecraft:apple: 1/);
  assert.match(field('By reward'), /Thor's Hammer: 1/);
});

test('execute: results accepts a full message link, not just a raw id', async () => {
  // a real Discord message id in a jump link is a numeric snowflake
  feedbackPosts.create({ messageId: '345678901234567890', channelId: 'CHAN-C', authorId: 'ADMIN1', message: 'm2', rewards: [] });
  const client = makeFakeClient();
  const jumpLink = 'https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890';
  const i = mkCommandInteraction({ subcommand: 'results', messageOption: jumpLink, client });
  await execute(i);
  assert.equal(i._replies.length, 1);
  const embed = i._replies[0].embeds[0].data;
  assert.equal(embed.description, 'm2');
});

// ================= handleModal =================

test('handleModal: a bad rewards line rejects the whole submission, nothing posted', async () => {
  const client = makeFakeClient();
  const i = mkModalInteraction({ channelId: 'CHAN-B', message: 'How are we doing?', rewards: '1 NOT VALID', client });
  await handleModal(i);
  assert.match(i._replies[0].content, /Line 1/);
  assert.equal((await client.channels.fetch('CHAN-B')).sentMessages.length, 0);
});

test('handleModal: valid submission posts the embed+buttons and saves the post', async () => {
  const client = makeFakeClient();
  const i = mkModalInteraction({
    channelId: 'CHAN-B',
    message: 'How are we doing?',
    rewards: REWARDS_TEXT,
    client,
  });
  await handleModal(i);
  assert.match(i._replies[0].content, /Posted to/);

  const chan = await client.channels.fetch('CHAN-B');
  assert.equal(chan.sentMessages.length, 1);
  const sent = chan.sentMessages[0];
  assert.equal(sent.embeds[0].data.description, 'How are we doing?');
  const buttons = sent.components[0].toJSON().components;
  assert.deepEqual(
    buttons.map((b) => b.custom_id),
    ['feedback:vote:up', 'feedback:vote:down'],
  );

  const postMessageId = chan.sentIds[0];
  const post = feedbackPosts.get(postMessageId);
  assert.ok(post);
  assert.equal(post.rewards.length, 2);
  assert.equal(post.rewards[0].commandTemplate, 'give {player} minecraft:apple 3');
  assert.equal(post.rewards[1].label, "Thor's Hammer");
});

// ================= handleButton =================

test('handleButton: untracked message -> "no longer tracked"', async () => {
  const client = makeFakeClient();
  const i = mkButtonInteraction({ userId: 'U1', messageId: 'no-such-message', client });
  await handleButton(i);
  assert.match(i._replies[0].content, /no longer tracked/);
});

test('handleButton: post with zero rewards -> thank-you, no_reward claim recorded', async () => {
  feedbackPosts.create({ messageId: 'post-noreward', channelId: 'CHAN-C', authorId: 'ADMIN1', message: 'm', rewards: [] });
  const client = makeFakeClient();
  const i = mkButtonInteraction({ userId: 'U-NOREWARD', sentiment: 'up', messageId: 'post-noreward', client });
  await handleButton(i);
  assert.match(i._replies[0].content, /Thanks for your feedback/);
  const claim = feedbackClaims.get('post-noreward', 'U-NOREWARD');
  assert.equal(claim.status, 'no_reward');
  assert.equal(claim.mc_uuid, null);
});

test('handleButton: post with rewards, unlinked user -> asked to /link first, no claim row written', async () => {
  feedbackPosts.create({
    messageId: 'post-rewards-1',
    channelId: 'CHAN-C',
    authorId: 'ADMIN1',
    message: 'm',
    rewards: [{ label: '3× minecraft:apple', commandTemplate: 'give {player} minecraft:apple 3' }],
  });
  const client = makeFakeClient();
  const i = mkButtonInteraction({ userId: 'U-UNLINKED', messageId: 'post-rewards-1', client });
  await handleButton(i);
  assert.match(i._replies[0].content, /link/i);
  assert.equal(feedbackClaims.get('post-rewards-1', 'U-UNLINKED'), undefined);
});

test('handleButton: post with rewards, linked user -> ephemeral select menu with one option per reward', async () => {
  links.create({ discordId: 'U-LINKED-1', mcUuid: 'uuid-linked-1', mcName: 'Alice', linkedBy: 'U-LINKED-1' });
  feedbackPosts.create({
    messageId: 'post-rewards-2',
    channelId: 'CHAN-C',
    authorId: 'ADMIN1',
    message: 'm',
    rewards: [
      { label: '3× minecraft:apple', commandTemplate: 'give {player} minecraft:apple 3' },
      { label: "Thor's Hammer", commandTemplate: 'thorshammer give {player} 1' },
    ],
  });
  const client = makeFakeClient();
  const i = mkButtonInteraction({ userId: 'U-LINKED-1', messageId: 'post-rewards-2', client });
  await handleButton(i);
  const menu = i._replies[0].components[0].toJSON().components[0];
  assert.equal(menu.custom_id, 'feedback:pick:post-rewards-2:up');
  assert.equal(menu.options.length, 2);
});

test('handleButton: clicking twice on the same post -> "already claimed", second reply', async () => {
  feedbackPosts.create({ messageId: 'post-double', channelId: 'CHAN-C', authorId: 'ADMIN1', message: 'm', rewards: [] });
  const client = makeFakeClient();
  const first = mkButtonInteraction({ userId: 'U-DOUBLE', messageId: 'post-double', client });
  await handleButton(first);
  const second = mkButtonInteraction({ userId: 'U-DOUBLE', messageId: 'post-double', client });
  await handleButton(second);
  assert.match(second._replies[0].content, /already/i);
});

// ================= handleSelectMenu =================

test('handleSelectMenu: player online -> delivered now, correct RCON command sent', async () => {
  links.create({ discordId: 'U-ONLINE', mcUuid: 'uuid-online', mcName: 'Steve', linkedBy: 'U-ONLINE' });
  feedbackPosts.create({
    messageId: 'post-online',
    channelId: 'CHAN-C',
    authorId: 'ADMIN1',
    message: 'm',
    rewards: [{ label: '3× minecraft:apple', commandTemplate: 'give {player} minecraft:apple 3' }],
  });
  resetRcon({ online: ['Steve'] });

  const client = makeFakeClient();
  const i = mkSelectInteraction({ userId: 'U-ONLINE', postId: 'post-online', valueIndex: 0, client });
  await handleSelectMenu(i);

  assert.match(i._updates[0].content, /delivered now/);
  assert.ok(sentCommands.includes('give Steve minecraft:apple 3'));
  const claim = feedbackClaims.get('post-online', 'U-ONLINE');
  assert.equal(claim.status, 'delivered');
  assert.ok(claim.delivered_at);
});

test('handleSelectMenu: player offline -> queued, no give sent', async () => {
  links.create({ discordId: 'U-OFFLINE', mcUuid: 'uuid-offline', mcName: 'Bob', linkedBy: 'U-OFFLINE' });
  feedbackPosts.create({
    messageId: 'post-offline',
    channelId: 'CHAN-C',
    authorId: 'ADMIN1',
    message: 'm',
    rewards: [{ label: '3× minecraft:apple', commandTemplate: 'give {player} minecraft:apple 3' }],
  });
  resetRcon({ online: [] });

  const client = makeFakeClient();
  const i = mkSelectInteraction({ userId: 'U-OFFLINE', postId: 'post-offline', valueIndex: 0, client });
  await handleSelectMenu(i);

  assert.match(i._updates[0].content, /next time you're online/);
  assert.ok(!sentCommands.some((c) => c.startsWith('give Bob')));
  const claim = feedbackClaims.get('post-offline', 'U-OFFLINE');
  assert.equal(claim.status, 'queued');
  assert.equal(claim.delivered_at, null);
  assert.ok(feedbackClaims.queued().some((c) => c.id === claim.id));
});

test('handleSelectMenu: RCON failure during immediate delivery falls back to queued, not lost', async () => {
  links.create({ discordId: 'U-FLAKY', mcUuid: 'uuid-flaky', mcName: 'Flaky', linkedBy: 'U-FLAKY' });
  feedbackPosts.create({
    messageId: 'post-flaky',
    channelId: 'CHAN-C',
    authorId: 'ADMIN1',
    message: 'm',
    rewards: [{ label: '3× minecraft:apple', commandTemplate: 'give {player} minecraft:apple 3' }],
  });
  resetRcon({ online: ['Flaky'] });
  failCommandSubstring = 'give Flaky';

  const client = makeFakeClient();
  const i = mkSelectInteraction({ userId: 'U-FLAKY', postId: 'post-flaky', valueIndex: 0, client });
  await handleSelectMenu(i);

  assert.match(i._updates[0].content, /next time you're online/);
  const claim = feedbackClaims.get('post-flaky', 'U-FLAKY');
  assert.equal(claim.status, 'queued');
  failCommandSubstring = null;
});

// ================= double-claim / double-dip guard =================

test('handleSelectMenu: same user picking twice -> second is rejected, no second RCON send', async () => {
  links.create({ discordId: 'U-TWICE', mcUuid: 'uuid-twice', mcName: 'Twice', linkedBy: 'U-TWICE' });
  feedbackPosts.create({
    messageId: 'post-twice',
    channelId: 'CHAN-C',
    authorId: 'ADMIN1',
    message: 'm',
    rewards: [{ label: '3× minecraft:apple', commandTemplate: 'give {player} minecraft:apple 3' }],
  });
  resetRcon({ online: ['Twice'] });

  const client = makeFakeClient();
  await handleSelectMenu(mkSelectInteraction({ userId: 'U-TWICE', postId: 'post-twice', valueIndex: 0, client }));
  const commandsAfterFirst = sentCommands.length;

  const second = mkSelectInteraction({ userId: 'U-TWICE', postId: 'post-twice', valueIndex: 0, client });
  await handleSelectMenu(second);

  assert.match(second._updates[0].content, /already claimed/);
  assert.equal(sentCommands.length, commandsAfterFirst); // no second give sent
});

test('handleSelectMenu: different Discord account relinked to the same mc_uuid cannot double-dip', async () => {
  links.create({ discordId: 'U-DIPPER-1', mcUuid: 'uuid-shared', mcName: 'Shared', linkedBy: 'U-DIPPER-1' });
  feedbackPosts.create({
    messageId: 'post-dip',
    channelId: 'CHAN-C',
    authorId: 'ADMIN1',
    message: 'm',
    rewards: [{ label: '3× minecraft:apple', commandTemplate: 'give {player} minecraft:apple 3' }],
  });
  resetRcon({ online: ['Shared'] });

  const client = makeFakeClient();
  await handleSelectMenu(mkSelectInteraction({ userId: 'U-DIPPER-1', postId: 'post-dip', valueIndex: 0, client }));

  // unlink, then relink a DIFFERENT Discord account to the same underlying Minecraft character
  links.deleteByDiscordId('U-DIPPER-1');
  links.create({ discordId: 'U-DIPPER-2', mcUuid: 'uuid-shared', mcName: 'Shared', linkedBy: 'U-DIPPER-2' });

  const buttonClient = makeFakeClient();
  await handleButton(mkButtonInteraction({ userId: 'U-DIPPER-2', messageId: 'post-dip', client: buttonClient }));

  const commandsBeforeSecondPick = sentCommands.length;
  const second = mkSelectInteraction({ userId: 'U-DIPPER-2', postId: 'post-dip', valueIndex: 0, client });
  await handleSelectMenu(second);

  assert.match(second._updates[0].content, /already claimed/);
  assert.equal(sentCommands.length, commandsBeforeSecondPick); // no give sent for the relinked account
});

// ================= offline-delivery poller (deliverReward directly) =================

test('deliverReward: substitutes {player}, sends the resolved command, marks delivered', async () => {
  links.create({ discordId: 'U-POLL', mcUuid: 'uuid-poll', mcName: 'Polly', linkedBy: 'U-POLL' });
  feedbackPosts.create({
    messageId: 'post-poll',
    channelId: 'CHAN-C',
    authorId: 'ADMIN1',
    message: 'm',
    rewards: [{ label: "Thor's Hammer", commandTemplate: 'thorshammer give {player} 1' }],
  });
  resetRcon({ online: [] });

  const claim = feedbackClaims.create({
    postId: 'post-poll',
    discordId: 'U-POLL',
    mcUuid: 'uuid-poll',
    sentiment: 'up',
    rewardLabel: "Thor's Hammer",
    commandTemplate: 'thorshammer give {player} 1',
    wasOnline: false,
    status: 'queued',
  });
  const claimId = claim.lastInsertRowid;
  assert.ok(feedbackClaims.queued().some((c) => c.id === claimId));

  const client = makeFakeClient();
  await deliverReward(client, { id: claimId, discord_id: 'U-POLL', command_template: 'thorshammer give {player} 1' }, 'Polly');

  assert.ok(sentCommands.includes('thorshammer give Polly 1'));
  assert.equal(feedbackClaims.queued().some((c) => c.id === claimId), false);
});
