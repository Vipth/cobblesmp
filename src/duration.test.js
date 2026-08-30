import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from './duration.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('formatDuration: sub-minute', () => {
  assert.equal(formatDuration(30_000), 'under a minute');
});

test('formatDuration: minutes only', () => {
  assert.equal(formatDuration(45 * MIN), '45m');
});

test('formatDuration: hours and minutes', () => {
  assert.equal(formatDuration(3 * HOUR + 12 * MIN), '3h 12m');
});

test('formatDuration: days trim to two units', () => {
  assert.equal(formatDuration(1 * DAY + 3 * HOUR + 45 * MIN), '1d 3h');
});

test('formatDuration: exact hour', () => {
  assert.equal(formatDuration(2 * HOUR), '2h');
});

test('formatDuration: days with no hours', () => {
  assert.equal(formatDuration(2 * DAY + 15 * MIN), '2d 15m');
});
