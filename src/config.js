import 'dotenv/config';

/**
 * Central config. Reads from the environment (populated by `.env` locally or by
 * docker-compose `env_file` in production), validates on boot, and exits with a
 * readable message when something required is missing.
 */

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    console.error(`[config] Missing required environment variable: ${name}`);
    console.error('[config] Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

const MC_COLORS = new Set([
  'black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple',
  'gold', 'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple',
  'yellow', 'white',
]);

/** A Minecraft colour name, or a #RRGGBB hex value; falls back with a warning. */
function color(name, fallback) {
  const v = optional(name, fallback);
  if (MC_COLORS.has(v) || /^#[0-9a-fA-F]{6}$/.test(v)) return v;
  console.warn(`[config] ${name}="${v}" is not a Minecraft colour name or #hex; using "${fallback}"`);
  return fallback;
}

function list(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function int(name, fallback, { min } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    console.error(`[config] ${name} must be an integer, got "${raw}"`);
    process.exit(1);
  }
  if (min !== undefined && n < min) {
    console.error(`[config] ${name} must be >= ${min}, got ${n}`);
    process.exit(1);
  }
  return n;
}

const banSyncMode = optional('BAN_SYNC_MODE', 'propose').toLowerCase();
if (!['auto', 'propose'].includes(banSyncMode)) {
  console.error(`[config] BAN_SYNC_MODE must be "auto" or "propose", got "${banSyncMode}"`);
  process.exit(1);
}

const whitelistMode = optional('WHITELIST_MODE', 'off').toLowerCase();
if (!['off', 'additive', 'strict'].includes(whitelistMode)) {
  console.error(
    `[config] WHITELIST_MODE must be "off", "additive" or "strict", got "${whitelistMode}"`,
  );
  process.exit(1);
}

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('GUILD_ID'),
    adminRoleId: required('ADMIN_ROLE_ID'),
    logChannelId: required('LOG_CHANNEL_ID'),
    // optional: role given to members who have linked a Minecraft account ('' = off)
    linkedRoleId: optional('LINKED_ROLE_ID', ''),
  },
  rcon: {
    host: optional('RCON_HOST', '127.0.0.1'),
    port: int('RCON_PORT', 25575),
    password: required('RCON_PASSWORD'),
    dryRun: bool('RCON_DRY_RUN', false),
  },
  banSync: {
    intervalMs: int('BAN_SYNC_INTERVAL_MS', 60_000, { min: 10_000 }),
    mode: banSyncMode,
    loopGuardMinutes: int('BAN_SYNC_LOOP_GUARD_MINUTES', 5, { min: 1 }),
  },
  whitelist: {
    // 'off'      -> /link adds, /unlink removes, nothing else
    // 'additive' -> also `whitelist on`, keep every linked user whitelisted,
    //               REPORT (not remove) whitelisted accounts with no link
    // 'strict'   -> additive + REMOVE and kick whitelisted accounts not linked/exempt
    mode: whitelistMode,
    exempt: list('WHITELIST_EXEMPT'),
    reconcileIntervalMs: int('WHITELIST_RECONCILE_INTERVAL_MS', 300_000, { min: 60_000 }),
  },
  presence: {
    // poller that tracks playtime / last-seen / first-join by polling `list`
    enabled: bool('PRESENCE_ENABLED', false),
    // set a channel too and joins/leaves/first-joins get posted there
    channelId: optional('PRESENCE_CHANNEL_ID', ''),
    intervalMs: int('PRESENCE_INTERVAL_MS', 60_000, { min: 15_000 }),
    // true = join posts ping the linked member
    mention: bool('PRESENCE_MENTION', false),
  },
  databasePath: optional('DATABASE_PATH', './data/cobblesmp.db'),
  deployCommandsOnStart: bool('DEPLOY_COMMANDS_ON_START', false),
  // /say is rendered via tellraw (not the vanilla `say`, which shows "[Rcon]").
  // SAY_PREFIX supports legacy & colour codes, e.g. "&6[&cBroadcast&6]".
  sayPrefix: optional('SAY_PREFIX', '&6[&cBroadcast&6]'),
  sayPrefixColor: color('SAY_PREFIX_COLOR', 'gold'), // fallback for uncoded prefix text
  sayDefaultColor: color('SAY_DEFAULT_COLOR', 'white'),
};
