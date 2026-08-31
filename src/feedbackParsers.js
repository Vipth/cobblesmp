import { assertItemId, clampCount, ValidationError } from './rcon.js';

/**
 * Parses the free-text "rewards" field from the /feedback modal into a list
 * of { label, commandTemplate } options. Kept pure and dependency-free (bar
 * the rcon.js validators) so it can be unit tested directly.
 *
 * Every reward normalizes to a commandTemplate — an RCON command string
 * containing the literal placeholder "{player}", substituted with the
 * claimer's Minecraft username at delivery time. Two input line shapes:
 *
 *   "<qty> <item_id>"              -> shorthand for `give {player} <item_id> <qty>`
 *   "cmd:<template>"               -> the template verbatim (must contain {player})
 *   "cmd:<label>|<template>"       -> same, with an explicit display label
 */

const SHORTHAND_RE = /^(\d+)\s+(\S+)$/;
const CMD_PREFIX = 'cmd:';
const MAX_CMD_LENGTH = 300;

/**
 * @param {string} text
 * @returns {{ rewards: Array<{label: string, commandTemplate: string}>, error: null }
 *          | { rewards: null, error: { line: number, raw: string, message: string } }}
 */
export function parseRewardLines(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line, i) => ({ line: i + 1, raw: line.trim() }))
    .filter(({ raw }) => raw.length > 0);

  const rewards = [];
  for (const { line, raw } of lines) {
    try {
      rewards.push(raw.toLowerCase().startsWith(CMD_PREFIX) ? parseCommandLine(raw) : parseShorthandLine(raw));
    } catch (err) {
      if (err instanceof ValidationError) {
        return { rewards: null, error: { line, raw, message: err.message } };
      }
      throw err;
    }
  }

  return { rewards, error: null };
}

function parseShorthandLine(raw) {
  const m = raw.match(SHORTHAND_RE);
  if (!m) {
    throw new ValidationError(
      `"${raw}" is not "<qty> <item_id>" (e.g. "3 minecraft:apple") or a "cmd:" line.`,
    );
  }
  const [, qtyRaw, itemRaw] = m;
  const itemId = assertItemId(itemRaw);
  const qty = clampCount(qtyRaw);
  return { label: `${qty}× ${itemId}`, commandTemplate: `give {player} ${itemId} ${qty}` };
}

function parseCommandLine(raw) {
  const body = raw.slice(CMD_PREFIX.length).trim();
  if (!body) throw new ValidationError('"cmd:" line is empty.');

  const pipeAt = body.indexOf('|');
  const label = pipeAt === -1 ? null : body.slice(0, pipeAt).trim();
  const commandTemplate = (pipeAt === -1 ? body : body.slice(pipeAt + 1).trim());

  if (!commandTemplate) throw new ValidationError('"cmd:" line has no command after "|".');
  if (commandTemplate.length > MAX_CMD_LENGTH) {
    throw new ValidationError(`Command is too long (max ${MAX_CMD_LENGTH} characters).`);
  }
  if (!commandTemplate.includes('{player}')) {
    throw new ValidationError('"cmd:" line must include the {player} placeholder.');
  }

  return { label: label || commandTemplate, commandTemplate };
}
