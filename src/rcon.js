import { Rcon } from 'rcon-client';
import { config } from './config.js';

/**
 * RCON connection singleton.
 *
 * - one physical connection, lazily established
 * - every send() is serialized through a queue (one command in flight at a time)
 * - reconnects with exponential backoff; never throws the process down
 * - RCON_DRY_RUN short-circuits send() to a logged no-op
 *
 * RCON is console-level (op 4) with a single privilege tier, so *nothing* built
 * from user input should reach send() unvalidated. Use the assert* helpers below.
 */

const MAX_BACKOFF_MS = 60_000;
const COMMAND_TIMEOUT_MS = 10_000;

class RconClient {
  #rcon = null;
  #connecting = null;
  #queue = Promise.resolve();
  #backoff = 1_000;
  #closed = false;
  /** Optional callback(errorMessage) invoked when the connection is unhealthy for a while. */
  onUnhealthy = null;
  #unhealthyNotified = false;

  get dryRun() {
    return config.rcon.dryRun;
  }

  async #connect() {
    if (this.#rcon) return this.#rcon;
    if (this.#connecting) return this.#connecting;

    this.#connecting = (async () => {
      const rcon = await Rcon.connect({
        host: config.rcon.host,
        port: config.rcon.port,
        password: config.rcon.password,
        timeout: COMMAND_TIMEOUT_MS,
      });
      rcon.on('error', (err) => {
        console.error('[rcon] socket error:', err.message);
      });
      rcon.on('end', () => {
        if (this.#rcon === rcon) this.#rcon = null;
        if (!this.#closed) console.warn('[rcon] connection ended');
      });
      this.#rcon = rcon;
      this.#backoff = 1_000;
      this.#unhealthyNotified = false;
      console.log(`[rcon] connected to ${config.rcon.host}:${config.rcon.port}`);
      return rcon;
    })();

    try {
      return await this.#connecting;
    } finally {
      this.#connecting = null;
    }
  }

  #noteUnhealthy(message) {
    if (this.#unhealthyNotified) return;
    this.#unhealthyNotified = true;
    try {
      this.onUnhealthy?.(message);
    } catch (err) {
      console.error('[rcon] onUnhealthy handler threw:', err);
    }
  }

  /**
   * Send a raw command string. Callers are responsible for having validated
   * every interpolated value. Returns the server's text response.
   */
  async send(command) {
    if (this.dryRun) {
      console.log(`[rcon:dry-run] ${command}`);
      return `[dry-run] ${command}`;
    }

    // chain onto the queue so commands never overlap on the single socket
    const run = this.#queue.then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const rcon = await this.#connect();
          const res = await rcon.send(command);
          return res;
        } catch (err) {
          console.error(`[rcon] command failed (attempt ${attempt + 1}): ${err.message}`);
          if (this.#rcon) {
            try {
              await this.#rcon.end();
            } catch {
              /* ignore */
            }
            this.#rcon = null;
          }
          if (attempt === 1) {
            this.#noteUnhealthy(`RCON command failed: ${err.message}`);
            throw err;
          }
          await this.#sleep(this.#nextBackoff());
        }
      }
      throw new Error('unreachable');
    });

    // keep the queue alive regardless of this command's outcome
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #nextBackoff() {
    const wait = this.#backoff;
    this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);
    return wait;
  }

  #sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async close() {
    this.#closed = true;
    if (this.#rcon) {
      try {
        await this.#rcon.end();
      } catch {
        /* ignore */
      }
      this.#rcon = null;
    }
  }
}

export const rcon = new RconClient();

// ---- validation helpers ------------------------------------------------

const MC_NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const ITEM_ID_RE = /^[a-z0-9_.-]+(:[a-z0-9_./-]+)?$/;

export function assertMcName(value) {
  const s = String(value ?? '').trim();
  if (!MC_NAME_RE.test(s)) {
    throw new ValidationError(
      `"${s}" is not a valid Minecraft username (3-16 letters, digits or underscore).`,
    );
  }
  return s;
}

export function assertItemId(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!ITEM_ID_RE.test(s)) {
    throw new ValidationError(`"${value}" is not a valid item id (e.g. minecraft:diamond).`);
  }
  return s.includes(':') ? s : `minecraft:${s}`;
}

export function clampCount(value, { min = 1, max = 64 } = {}) {
  const n = Number.parseInt(value ?? min, 10);
  if (Number.isNaN(n)) throw new ValidationError(`"${value}" is not a number.`);
  return Math.min(Math.max(n, min), max);
}

/** Accept another player name, or "x y z" coordinates (numbers, optional ~ prefix). */
export function assertTeleportDestination(value) {
  const s = String(value ?? '').trim();
  if (MC_NAME_RE.test(s)) return s;
  const coord = /^-?~?\d+(\.\d+)?$/;
  const parts = s.split(/\s+/);
  if (parts.length === 3 && parts.every((p) => coord.test(p))) return parts.join(' ');
  throw new ValidationError(
    `Destination must be a player name or three coordinates like "100 64 -200".`,
  );
}

/** Collapse a chat message to a single safe line and cap its length. */
export function sanitizeChatMessage(value, { max = 230 } = {}) {
  const s = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/§/g, '')
    .trim();
  if (!s) throw new ValidationError('Message is empty.');
  return s.slice(0, max);
}

/** Free-text reason: single line, capped, safe to append after a command. */
export function sanitizeReason(value, { max = 120 } = {}) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/§/g, '')
    .trim()
    .slice(0, max);
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}
