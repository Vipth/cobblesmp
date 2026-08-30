import { settings } from './db.js';

/**
 * Runtime toggles persisted in the `settings` table (survive restarts).
 */

const LINKING_OPEN = 'linking_open';

/** Whether players may use `/link` right now. Defaults to open. */
export const isLinkingOpen = () => settings.getBool(LINKING_OPEN, true);

export const setLinkingOpen = (open) => settings.setBool(LINKING_OPEN, open);
