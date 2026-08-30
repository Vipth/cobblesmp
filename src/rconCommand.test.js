import { test } from 'node:test';
import assert from 'node:assert/strict';

// Force a known config before config.js loads. dotenv does not override vars
// that are already set, so a real .env on disk can't affect these.
process.env.DISCORD_TOKEN = 'x';
process.env.DISCORD_CLIENT_ID = '1';
process.env.GUILD_ID = 'G';
process.env.ADMIN_ROLE_ID = 'ROLE';
process.env.LOG_CHANNEL_ID = '1';
process.env.RCON_PASSWORD = 'x';
process.env.DATABASE_PATH = ':memory:';

const { isAdmin } = await import('./rconCommand.js');

const mk = (over = {}) => ({
  inGuild: () => true,
  guildId: 'G',
  guild: { ownerId: 'OWNER' },
  user: { id: 'U' },
  member: { roles: { cache: new Set() } },
  ...over,
});

test('isAdmin: denies a member without the admin role', () => {
  assert.equal(isAdmin(mk()), false);
});

test('isAdmin: allows a member holding the admin role', () => {
  assert.equal(isAdmin(mk({ member: { roles: { cache: new Set(['ROLE']) } } })), true);
});

test('isAdmin: allows the guild owner regardless of roles', () => {
  assert.equal(isAdmin(mk({ user: { id: 'OWNER' } })), true);
});

test('isAdmin: Discord Administrator permission is NOT a bypass', () => {
  const i = mk({
    memberPermissions: { has: () => true },
    member: { roles: { cache: new Set(['SOME_OTHER_ROLE']) } },
  });
  assert.equal(isAdmin(i), false);
});

test('isAdmin: denies interactions from a different guild', () => {
  assert.equal(
    isAdmin(mk({ guildId: 'OTHER', member: { roles: { cache: new Set(['ROLE']) } } })),
    false,
  );
});

test('isAdmin: denies in DMs', () => {
  assert.equal(isAdmin(mk({ inGuild: () => false })), false);
});

test('isAdmin: supports raw array-shaped member roles', () => {
  assert.equal(isAdmin(mk({ member: { roles: ['ROLE'] } })), true);
});
