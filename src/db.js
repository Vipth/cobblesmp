import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { config } from './config.js';

mkdirSync(dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    discord_id TEXT PRIMARY KEY,
    mc_uuid    TEXT UNIQUE NOT NULL,
    mc_name    TEXT NOT NULL,
    linked_at  INTEGER NOT NULL,
    linked_by  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ban_state (
    mc_name TEXT PRIMARY KEY,
    seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ban_actions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    mc_name      TEXT,
    discord_id   TEXT,
    direction    TEXT NOT NULL,   -- 'd2m' | 'm2d'
    action       TEXT NOT NULL,   -- 'ban' | 'pardon'
    initiated_by TEXT NOT NULL,   -- 'bot' | 'admin' | 'poller'
    reason       TEXT,
    ts           INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ban_actions_lookup
    ON ban_actions (lower(mc_name), action, ts);
`);

const lc = (s) => (s == null ? s : String(s).toLowerCase());

// ---- links ---------------------------------------------------------------

const stmtGetLinkByDiscord = db.prepare('SELECT * FROM links WHERE discord_id = ?');
const stmtGetLinkByUuid = db.prepare('SELECT * FROM links WHERE mc_uuid = ?');
const stmtGetLinkByName = db.prepare('SELECT * FROM links WHERE lower(mc_name) = ?');
const stmtInsertLink = db.prepare(`
  INSERT INTO links (discord_id, mc_uuid, mc_name, linked_at, linked_by)
  VALUES (@discord_id, @mc_uuid, @mc_name, @linked_at, @linked_by)
`);
const stmtDeleteLinkByDiscord = db.prepare('DELETE FROM links WHERE discord_id = ?');
const stmtUpdateLinkName = db.prepare('UPDATE links SET mc_name = ? WHERE mc_uuid = ?');
const stmtAllLinks = db.prepare('SELECT * FROM links ORDER BY linked_at DESC');
const stmtCountLinks = db.prepare('SELECT COUNT(*) AS n FROM links');

export const links = {
  getByDiscordId: (id) => stmtGetLinkByDiscord.get(id),
  getByUuid: (uuid) => stmtGetLinkByUuid.get(uuid),
  getByName: (name) => stmtGetLinkByName.get(lc(name)),
  create: ({ discordId, mcUuid, mcName, linkedBy }) =>
    stmtInsertLink.run({
      discord_id: discordId,
      mc_uuid: mcUuid,
      mc_name: mcName,
      linked_at: Date.now(),
      linked_by: linkedBy,
    }),
  deleteByDiscordId: (id) => stmtDeleteLinkByDiscord.run(id),
  updateName: (uuid, name) => stmtUpdateLinkName.run(name, uuid),
  all: () => stmtAllLinks.all(),
  count: () => stmtCountLinks.get().n,
};

// ---- ban_state ----------------------------------------------------------

const stmtAllBanState = db.prepare('SELECT mc_name FROM ban_state');
const stmtReplaceBanState = db.transaction((names) => {
  db.prepare('DELETE FROM ban_state').run();
  const insert = db.prepare('INSERT INTO ban_state (mc_name, seen_at) VALUES (?, ?)');
  const now = Date.now();
  for (const name of names) insert.run(name, now);
});

const stmtHasBanState = db.prepare('SELECT 1 FROM ban_state WHERE lower(mc_name) = ? LIMIT 1');

export const banState = {
  all: () => stmtAllBanState.all().map((r) => r.mc_name),
  replace: (names) => stmtReplaceBanState(names),
  has: (name) => Boolean(stmtHasBanState.get(lc(name))),
};

// ---- ban_actions ------------------------------------------------------

const stmtInsertBanAction = db.prepare(`
  INSERT INTO ban_actions (mc_name, discord_id, direction, action, initiated_by, reason, ts)
  VALUES (@mc_name, @discord_id, @direction, @action, @initiated_by, @reason, @ts)
`);
const stmtRecentAction = db.prepare(`
  SELECT * FROM ban_actions
  WHERE lower(mc_name) = ? AND action = ? AND ts >= ?
  ORDER BY ts DESC LIMIT 1
`);
const stmtLastActionForName = db.prepare(`
  SELECT * FROM ban_actions
  WHERE lower(mc_name) = ?
  ORDER BY ts DESC LIMIT 1
`);
const stmtLastBanForName = db.prepare(`
  SELECT * FROM ban_actions
  WHERE lower(mc_name) = ? AND action = 'ban'
  ORDER BY ts DESC LIMIT 1
`);

export const banActions = {
  record: ({ mcName = null, discordId = null, direction, action, initiatedBy, reason = null }) =>
    stmtInsertBanAction.run({
      mc_name: mcName,
      discord_id: discordId,
      direction,
      action,
      initiated_by: initiatedBy,
      reason,
      ts: Date.now(),
    }),
  /** Was `action` taken on `mcName` within the last `minutes`? Used as the loop guard. */
  recent: (mcName, action, minutes) =>
    stmtRecentAction.get(lc(mcName), action, Date.now() - minutes * 60_000),
  lastForName: (mcName) => stmtLastActionForName.get(lc(mcName)),
  /** Most recent 'ban' row for a name (null if the ban predates the bot). */
  lastBan: (mcName) => stmtLastBanForName.get(lc(mcName)),
};

// ---- settings (small key/value store for runtime toggles) --------------

const stmtGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtSetSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

export const settings = {
  get: (key, fallback = null) => stmtGetSetting.get(key)?.value ?? fallback,
  set: (key, value) => stmtSetSetting.run(key, String(value)),
  getBool: (key, fallback = false) => {
    const row = stmtGetSetting.get(key);
    return row ? row.value === '1' : fallback;
  },
  setBool: (key, value) => stmtSetSetting.run(key, value ? '1' : '0'),
};

export function closeDb() {
  db.close();
}

export default db;
