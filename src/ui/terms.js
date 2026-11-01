import { currentTerms, setOption } from '../settings/store.js';
import { DIFFICULTIES } from '../config/presets.js';

/* ============================================================
   THE TERMS OF THE SHIFT (difficulty)
   The terms are chosen on the work order page of the binder, before the run
   starts, and not while paused. Changing them mid-run would rewrite the clock,
   repair time and chase speed under a floor already being played, while the
   number of lives was fixed at the start.

   The chooser is always visible on the work order page, and whatever it shows
   when the player clocks in is what the run is built with.

   The value is saved, so a returning player sees their last choice, and a new
   player sees NORMAL. paintTerms() is the one place the derived text is
   written, and syncSettingsUI() calls it, so every way the value can change
   (the chooser, the number keys, RESET SETTINGS, a reloaded save) leaves the
   note, the pause page and the field manual showing the same thing.
   ============================================================ */

/* Turns seconds into words for the field manual: 240 is "4 minutes", 150 is
   "2 minutes 30 seconds". */
export function proseClock(s){
  const m = Math.floor(s/60), r = Math.round(s%60);
  const mins = m ? `${m} minute${m===1?'':'s'}` : '';
  const secs = r ? `${r} second${r===1?'':'s'}` : '';
  return [mins, secs].filter(Boolean).join(' ') || 'no time at all';
}

// A clock as the HUD writes it: 150 is "2:30".
function clockWords(s){
  return `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
}

/* Writes the current terms into every place that shows them: the note under
   the chooser, the pause page, and the clock and seal times in the field
   manual. */
export function paintTerms(){
  const d = currentTerms();
  const set = (id, txt)=>{ const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('pause-terms', d.label);
  set('manual-return', proseClock(d.clock));
  set('manual-repair', `${d.repairTime} second${d.repairTime===1?'':'s'}`);
  set('note-difficulty',
    `${d.lives} ${d.lives===1?'life':'lives'} \u00b7 ${clockWords(d.clock)} per floor \u00b7 ${d.repairTime}s to seal a leak`);
}

/**
 * Handles a key press on the work order page. The number keys pick terms (in
 * DIFFICULTIES order). The arrow keys are not used here: they turn the binder
 * pages.
 *
 * @param {KeyboardEvent} e
 * @returns {boolean} true if the key was one of the chooser's.
 */
export function handleTermsKey(e){
  const list = Object.keys(DIFFICULTIES);
  if (/^[1-9]$/.test(e.key) && +e.key <= list.length){
    setOption('difficulty', list[+e.key-1]);
    e.preventDefault();
    return true;
  }
  return false;
}
