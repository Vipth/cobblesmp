import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, parseBanlist, parseWhitelist } from './parsers.js';

test('parseList: players online', () => {
  const r = parseList('There are 2 of a max of 20 players online: Alice, Bob');
  assert.equal(r.online, 2);
  assert.equal(r.max, 20);
  assert.deepEqual(r.players, ['Alice', 'Bob']);
});

test('parseList: nobody online', () => {
  const r = parseList('There are 0 of a max of 20 players online:');
  assert.equal(r.online, 0);
  assert.deepEqual(r.players, []);
});

test('parseList: legacy slash format', () => {
  const r = parseList('There are 1/20 players online: Alice');
  assert.equal(r.online, 1);
  assert.equal(r.max, 20);
  assert.deepEqual(r.players, ['Alice']);
});

test('parseList: strips section colour codes', () => {
  const r = parseList('There are 1 of a max of 20 players online: §aAlice');
  assert.deepEqual(r.players, ['Alice']);
});

test('parseWhitelist: three names', () => {
  const r = parseWhitelist('There are 3 whitelisted players: Alice, Bob, Carol');
  assert.deepEqual(r.names, ['Alice', 'Bob', 'Carol']);
});

test('parseWhitelist: legacy player(s) wording', () => {
  const r = parseWhitelist('There are 2 whitelisted player(s): Alice, Bob');
  assert.deepEqual(r.names, ['Alice', 'Bob']);
});

test('parseWhitelist: empty', () => {
  assert.deepEqual(parseWhitelist('There are no whitelisted players').names, []);
});

test('parseBanlist: no bans', () => {
  const r = parseBanlist('There are no bans');
  assert.deepEqual(r.names, []);
  assert.deepEqual(r.entries, []);
});

test('parseBanlist: two bans with and without reason', () => {
  const text =
    'There are 2 ban(s):\n' +
    'Alice was banned by Server: griefing spawn\n' +
    'Bob was banned by Operator: (No reason given)';
  const r = parseBanlist(text);
  assert.deepEqual(r.names, ['Alice', 'Bob']);
  assert.equal(r.entries[0].reason, 'griefing spawn');
  assert.equal(r.entries[0].source, 'Server');
  assert.equal(r.entries[1].reason, null);
});

test('parseBanlist: ignores IP-ban lines', () => {
  const text =
    'There are 2 ban(s):\n' +
    'Alice was banned by Server: cheating\n' +
    '192.168.1.50 was banned by Server: (No reason given)';
  const r = parseBanlist(text);
  assert.deepEqual(r.names, ['Alice']);
});
