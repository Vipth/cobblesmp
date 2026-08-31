import { settings } from './db.js';

/**
 * Runtime toggles persisted in the `settings` table (survive restarts).
 */

const LINKING_OPEN = 'linking_open';

/** Whether players may use `/link` right now. Defaults to open. */
export const isLinkingOpen = () => settings.getBool(LINKING_OPEN, true);

export const setLinkingOpen = (open) => settings.setBool(LINKING_OPEN, open);

const FEEDBACK_CHANNEL = 'feedback_channel_id';

/** Channel id saved by a previous /feedback run, or null if none/cleared. */
export const getFeedbackChannel = () => settings.get(FEEDBACK_CHANNEL, null);

export const setFeedbackChannel = (channelId) => settings.set(FEEDBACK_CHANNEL, channelId);

export const clearFeedbackChannel = () => settings.delete(FEEDBACK_CHANNEL);
