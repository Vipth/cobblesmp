import { test } from 'node:test';
import assert from 'node:assert/strict';

// Force a known config before config.js loads (feedbackParsers.js -> rcon.js -> config.js).
process.env.DISCORD_TOKEN = 'x';
process.env.DISCORD_CLIENT_ID = '1';
process.env.GUILD_ID = 'G';
process.env.ADMIN_ROLE_ID = 'ROLE';
process.env.LOG_CHANNEL_ID = '1';
process.env.RCON_PASSWORD = 'x';
process.env.DATABASE_PATH = ':memory:';

const { parseRewardLines } = await import('./feedbackParsers.js');

test('parseRewardLines: empty textarea -> no rewards', () => {
  assert.deepEqual(parseRewardLines(''), { rewards: [], error: null });
  assert.deepEqual(parseRewardLines('   \n  \n'), { rewards: [], error: null });
});

test('parseRewardLines: single shorthand line', () => {
  const { rewards, error } = parseRewardLines('3 minecraft:apple');
  assert.equal(error, null);
  assert.deepEqual(rewards, [{ label: '3× minecraft:apple', commandTemplate: 'give {player} minecraft:apple 3' }]);
});

test('parseRewardLines: bare item id defaults to minecraft: namespace', () => {
  const { rewards } = parseRewardLines('1 diamond');
  assert.equal(rewards[0].commandTemplate, 'give {player} minecraft:diamond 1');
});

test('parseRewardLines: modded namespace passes through', () => {
  const { rewards } = parseRewardLines('1 examplemod:thors_hammer');
  assert.equal(rewards[0].commandTemplate, 'give {player} examplemod:thors_hammer 1');
});

test('parseRewardLines: cmd line with label', () => {
  const { rewards, error } = parseRewardLines("cmd:Thor's Hammer|thorshammer give {player} 1");
  assert.equal(error, null);
  assert.deepEqual(rewards, [{ label: "Thor's Hammer", commandTemplate: 'thorshammer give {player} 1' }]);
});

test('parseRewardLines: cmd line without label falls back to the command text', () => {
  const { rewards } = parseRewardLines('cmd:thorshammer give {player} 1');
  assert.equal(rewards[0].label, 'thorshammer give {player} 1');
});

test('parseRewardLines: cmd line missing {player} is rejected', () => {
  const { rewards, error } = parseRewardLines('cmd:say hello world');
  assert.equal(rewards, null);
  assert.equal(error.line, 1);
  assert.match(error.message, /\{player\}/);
});

test('parseRewardLines: bad item id is rejected with the offending line number', () => {
  const { rewards, error } = parseRewardLines('1 minecraft:apple\n2 NOT VALID\n1 minecraft:diamond');
  assert.equal(rewards, null);
  assert.equal(error.line, 2);
});

test('parseRewardLines: blank lines between entries are skipped', () => {
  const { rewards, error } = parseRewardLines('1 minecraft:apple\n\n\n2 minecraft:diamond');
  assert.equal(error, null);
  assert.equal(rewards.length, 2);
});

test('parseRewardLines: out-of-range qty is clamped, not rejected', () => {
  const { rewards, error } = parseRewardLines('999 minecraft:apple');
  assert.equal(error, null);
  assert.equal(rewards[0].commandTemplate, 'give {player} minecraft:apple 64');
});

test('parseRewardLines: multiple mixed reward lines', () => {
  const { rewards, error } = parseRewardLines(
    "1 minecraft:apple\ncmd:Thor's Hammer|thorshammer give {player} 1",
  );
  assert.equal(error, null);
  assert.equal(rewards.length, 2);
  assert.equal(rewards[1].label, "Thor's Hammer");
});
