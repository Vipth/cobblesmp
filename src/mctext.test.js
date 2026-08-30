import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ampToComponents } from './mctext.js';

test('ampToComponents: gold brackets, red label', () => {
  assert.deepEqual(ampToComponents('&6[&cBroadcast&6]'), [
    { text: '[', color: 'gold' },
    { text: 'Broadcast', color: 'red' },
    { text: ']', color: 'gold' },
  ]);
});

test('ampToComponents: plain text uses the default colour', () => {
  assert.deepEqual(ampToComponents('[Broadcast]', 'gold'), [{ text: '[Broadcast]', color: 'gold' }]);
});

test('ampToComponents: style codes stack on colour', () => {
  assert.deepEqual(ampToComponents('&c&lALERT'), [{ text: 'ALERT', color: 'red', bold: true }]);
});

test('ampToComponents: colour code resets styling', () => {
  assert.deepEqual(ampToComponents('&lbold&rplain'), [
    { text: 'bold', color: 'white', bold: true },
    { text: 'plain', color: 'white' },
  ]);
});

test('ampToComponents: § is accepted too', () => {
  assert.deepEqual(ampToComponents('§aok'), [{ text: 'ok', color: 'green' }]);
});

test('ampToComponents: unknown code kept literal', () => {
  assert.deepEqual(ampToComponents('a&zb'), [{ text: 'a&zb', color: 'white' }]);
});

test('ampToComponents: empty input', () => {
  assert.deepEqual(ampToComponents(''), [{ text: '', color: 'white' }]);
});
