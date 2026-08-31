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

  CREATE TABLE IF NOT EXISTS presence (
    mc_uuid       TEXT PRIMARY KEY,
    mc_name       TEXT NOT NULL,
    playtime_ms   INTEGER NOT NULL DEFAULT 0,
    session_start INTEGER,            -- when the current session began; NULL when offline
    accrued_at    INTEGER,            -- last poll that credited playtime this session
    first_seen    INTEGER NOT NULL,
    last_seen     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedback_posts (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    author_id  TEXT NOT NULL,
    message    TEXT NOT NULL,
    rewards    TEXT NOT NULL,   -- JSON array of { label, commandTemplate }
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedback_claims (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_post_id    TEXT NOT NULL REFERENCES feedback_posts(message_id),
    discord_id          TEXT NOT NULL,
    mc_uuid             TEXT,        -- NULL only for a sentiment-only 'no_reward' claim
    sentiment           TEXT NOT NULL,   -- 'up' | 'down'
    reward_label        TEXT,        -- NULL when the post had no rewards
    command_template    TEXT,        -- NULL when the post had no rewards
    chosen_at           INTEGER NOT NULL,
    was_online_at_pick  INTEGER NOT NULL,   -- 0 | 1
    status              TEXT NOT NULL,   -- 'delivered' | 'queued' | 'no_reward'
    delivered_at        INTEGER,
    UNIQUE (feedback_post_id, discord_id),
    UNIQUE (feedback_post_id, mc_uuid)
  );

  CREATE INDEX IF NOT EXISTS idx_feedback_claims_queued
    ON feedback_claims (status);
`);

// ---- migrations (add columns that shipped in a later version) ----------
function addColumnIfMissing(table, column, def) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  return !has;
}
// presence.accrued_at was split out of session_start (which used to double as the
// accrual marker, so it couldn't show real session length)
if (addColumnIfMissing('presence', 'accrued_at', 'INTEGER')) {
  db.exec(
    `UPDATE presence SET accrued_at = session_start WHERE accrued_at IS NULL AND session_start IS NOT NULL`,
  );
}

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

// ---- presence (playtime / last-seen, keyed by MC uuid) ----------------

const stmtGetPresence = db.prepare('SELECT * FROM presence WHERE mc_uuid = ?');
const stmtOnlinePresence = db.prepare('SELECT * FROM presence WHERE session_start IS NOT NULL');
// total = banked playtime + time since the last poll that credited this session
const stmtTopPlaytime = db.prepare(`
  SELECT mc_uuid, mc_name, session_start,
         playtime_ms + CASE WHEN accrued_at IS NULL THEN 0
                            ELSE MAX(0, ? - accrued_at) END AS total_ms
  FROM presence
  ORDER BY total_ms DESC
  LIMIT ?
`);
// Only ever called for a session that is starting (a fresh join, or the priming
// poll after a restart), so always (re)set both timestamps — that also discards
// anything stale left over from a crash.
const stmtMarkOnline = db.prepare(`
  INSERT INTO presence (mc_uuid, mc_name, playtime_ms, session_start, accrued_at, first_seen, last_seen)
  VALUES (@uuid, @name, 0, @now, @now, @now, @now)
  ON CONFLICT(mc_uuid) DO UPDATE SET
    mc_name = excluded.mc_name,
    last_seen = excluded.last_seen,
    session_start = excluded.session_start,
    accrued_at = excluded.accrued_at
`);
const stmtTouch = db.prepare(
  'UPDATE presence SET mc_name = ?, last_seen = ? WHERE mc_uuid = ?',
);
// each poll: bank the time since the last poll, advance accrued_at, leave
// session_start alone. MAX(0, …) guards a backwards clock step (Pi has no RTC).
const stmtAccrue = db.prepare(`
  UPDATE presence
  SET playtime_ms = playtime_ms + MAX(0, ? - accrued_at), accrued_at = ?
  WHERE mc_uuid = ? AND accrued_at IS NOT NULL
`);
const stmtMarkOffline = db.prepare(`
  UPDATE presence
  SET playtime_ms = playtime_ms + MAX(0, ? - accrued_at),
      session_start = NULL, accrued_at = NULL, last_seen = ?
  WHERE mc_uuid = ? AND accrued_at IS NOT NULL
`);

export const presence = {
  get: (uuid) => stmtGetPresence.get(uuid),
  online: () => stmtOnlinePresence.all(),
  markOnline: (uuid, name, now) => stmtMarkOnline.run({ uuid, name, now }),
  touch: (uuid, name, now) => stmtTouch.run(name, now, uuid),
  accrue: (uuid, now) => stmtAccrue.run(now, now, uuid),
  markOffline: (uuid, now) => stmtMarkOffline.run(now, now, uuid),
  topByPlaytime: (limit, now = Date.now()) => stmtTopPlaytime.all(now, limit),
  /** total playtime including the live session */
  total: (row, now = Date.now()) =>
    row ? row.playtime_ms + (row.accrued_at ? Math.max(0, now - row.accrued_at) : 0) : 0,
};

// ---- settings (small key/value store for runtime toggles) --------------

const stmtGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtSetSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const stmtDeleteSetting = db.prepare('DELETE FROM settings WHERE key = ?');

export const settings = {
  get: (key, fallback = null) => stmtGetSetting.get(key)?.value ?? fallback,
  set: (key, value) => stmtSetSetting.run(key, String(value)),
  delete: (key) => stmtDeleteSetting.run(key),
  getBool: (key, fallback = false) => {
    const row = stmtGetSetting.get(key);
    return row ? row.value === '1' : fallback;
  },
  setBool: (key, value) => stmtSetSetting.run(key, value ? '1' : '0'),
};

// ---- feedback_posts / feedback_claims -----------------------------------

const stmtInsertFeedbackPost = db.prepare(`
  INSERT INTO feedback_posts (message_id, channel_id, author_id, message, rewards, created_at)
  VALUES (@message_id, @channel_id, @author_id, @message, @rewards, @created_at)
`);
const stmtGetFeedbackPost = db.prepare('SELECT * FROM feedback_posts WHERE message_id = ?');

export const feedbackPosts = {
  create: ({ messageId, channelId, authorId, message, rewards }) =>
    stmtInsertFeedbackPost.run({
      message_id: messageId,
      channel_id: channelId,
      author_id: authorId,
      message,
      rewards: JSON.stringify(rewards),
      created_at: Date.now(),
    }),
  get: (messageId) => {
    const row = stmtGetFeedbackPost.get(messageId);
    return row ? { ...row, rewards: JSON.parse(row.rewards) } : null;
  },
};

const stmtGetFeedbackClaim = db.prepare(
  'SELECT * FROM feedback_claims WHERE feedback_post_id = ? AND discord_id = ?',
);
const stmtFeedbackClaimsForPost = db.prepare(
  'SELECT * FROM feedback_claims WHERE feedback_post_id = ? ORDER BY chosen_at ASC',
);
const stmtInsertFeedbackClaim = db.prepare(`
  INSERT INTO feedback_claims (
    feedback_post_id, discord_id, mc_uuid, sentiment, reward_label, command_template,
    chosen_at, was_online_at_pick, status, delivered_at
  ) VALUES (
    @feedback_post_id, @discord_id, @mc_uuid, @sentiment, @reward_label, @command_template,
    @chosen_at, @was_online_at_pick, @status, @delivered_at
  )
`);
const stmtQueuedFeedbackClaims = db.prepare("SELECT * FROM feedback_claims WHERE status = 'queued'");
const stmtMarkFeedbackClaimDelivered = db.prepare(
  "UPDATE feedback_claims SET status = 'delivered', delivered_at = ? WHERE id = ?",
);

export const feedbackClaims = {
  get: (postId, discordId) => stmtGetFeedbackClaim.get(postId, discordId),
  forPost: (postId) => stmtFeedbackClaimsForPost.all(postId),
  /** Throws a better-sqlite3 SQLITE_CONSTRAINT_UNIQUE error on a double claim — caller catches it. */
  create: ({
    postId,
    discordId,
    mcUuid = null,
    sentiment,
    rewardLabel = null,
    commandTemplate = null,
    wasOnline = false,
    status,
    deliveredAt = null,
  }) =>
    stmtInsertFeedbackClaim.run({
      feedback_post_id: postId,
      discord_id: discordId,
      mc_uuid: mcUuid,
      sentiment,
      reward_label: rewardLabel,
      command_template: commandTemplate,
      chosen_at: Date.now(),
      was_online_at_pick: wasOnline ? 1 : 0,
      status,
      delivered_at: deliveredAt,
    }),
  queued: () => stmtQueuedFeedbackClaims.all(),
  markDelivered: (id, deliveredAt = Date.now()) => stmtMarkFeedbackClaimDelivered.run(deliveredAt, id),
};

export function closeDb() {
  db.close();
}

export default db;
