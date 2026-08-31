import { config } from './config.js';
import { feedbackClaims, links } from './db.js';
import { rcon } from './rcon.js';
import { isOnline } from './serverquery.js';
import { audit } from './rconCommand.js';

/**
 * Offline-reward delivery poller. Mirrors presence.js/bansync.js: an
 * interval that reads state straight from SQLite each tick (no in-memory
 * queue), so a bot restart never loses a queued claim.
 */

let timer = null;

export function startFeedbackDeliveryPoller(client) {
  if (!config.feedback.enabled) {
    console.log('[feedback] FEEDBACK_REWARDS_ENABLED=false — delivery poller disabled');
    return;
  }
  const tick = () =>
    pollOnce(client).catch((err) => console.error('[feedback] poll error:', err.message));
  timer = setInterval(tick, config.feedback.deliveryIntervalMs);
  if (timer.unref) timer.unref();
  console.log(
    `[feedback] delivery poller started (every ${Math.round(config.feedback.deliveryIntervalMs / 1000)}s)`,
  );
}

export function stopFeedbackDeliveryPoller() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function pollOnce(client) {
  const queued = feedbackClaims.queued();
  if (!queued.length) return;

  for (const claim of queued) {
    const link = links.getByDiscordId(claim.discord_id);
    if (!link) continue; // account was unlinked since queuing; retry once relinked

    const online = await isOnline(link.mc_name);
    if (online !== true) continue;

    try {
      await deliverReward(client, claim, link.mc_name);
    } catch (err) {
      console.error(`[feedback] delivery failed for claim ${claim.id}:`, err.message);
    }
  }
}

/** Substitute {player}, send the RCON command, and mark the claim delivered. Throws on RCON failure. */
export async function deliverReward(client, claim, mcName) {
  const command = claim.command_template.replaceAll('{player}', mcName);
  await rcon.send(command);
  feedbackClaims.markDelivered(claim.id);
  await audit(
    client,
    `🎁 Delivered feedback reward to \`${mcName}\` (<@${claim.discord_id}>): \`${command}\``,
  );
}
