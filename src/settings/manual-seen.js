/* Has this player clocked in before? The first shift opens the binder on the
   field manual. It is its own key and not part of SETTINGS, so RESET SETTINGS
   does not bring the manual back. localStorage may be missing (tests, private
   modes), so the answer is also kept in memory for the length of the session. */
export const MANUAL_SEEN_KEY = 'leakrooms.manual-seen.v1';

let seen = null;

/** @returns {boolean} true once the player has started a shift. */
export function manualSeen(){
  if (seen === null){
    try { seen = localStorage.getItem(MANUAL_SEEN_KEY) === '1'; }
    catch (e){ seen = false; }
  }
  return seen;
}

/** Records that the player has started a shift. Never throws. */
export function markManualSeen(){
  seen = true;
  try { localStorage.setItem(MANUAL_SEEN_KEY, '1'); } catch (e){ /* memory only */ }
}

/** Test hook: sets the in-memory flag without touching storage. @param {boolean} v */
export function setManualSeen(v){ seen = !!v; }
