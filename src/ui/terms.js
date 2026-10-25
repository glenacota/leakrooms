import { FLOOR_CLOCK, REPAIR_TIME } from '../config/tuning.js';
import { SETTINGS, currentTerms } from '../settings/store.js';
import { clearInput } from '../sim/keys.js';

/* ============================================================
   THE TERMS OF THE SHIFT (difficulty)
   Difficulty is chosen on the work order screen, before the run starts, and
   not on the pause screen. Changing it mid-run would rewrite the clock, repair
   time and chase speed under a floor already being played, while the number of
   lives was fixed at the start.

   The work order shows the current choice as a stamp. CHANGE opens a chooser,
   and whatever the stamp says when the player clocks in is what the run is
   built with.

   The value is saved, so a returning player sees their last choice, and a new
   player sees NORMAL. paintTerms() is the one place the stamp is written, and
   syncSettingsUI() calls it, so every way the value can change (the chooser,
   the number keys, RESET SETTINGS, a reloaded save) leaves the stamps and the
   note showing the same thing.
   ============================================================ */
export let termsOpen = false;

/* Turns seconds into words for the work order text: 240 is "4 minutes", 150 is
   "2 minutes 30 seconds". */
export function proseClock(s){
  const m = Math.floor(s/60), r = Math.round(s%60);
  const mins = m ? `${m} minute${m===1?'':'s'}` : '';
  const secs = r ? `${r} second${r===1?'':'s'}` : '';
  return [mins, secs].filter(Boolean).join(' ') || 'no time at all';
}

/* Writes the current difficulty into every place that shows it: the stamp, the
   pause screen, the clock and repair times in the work order and the briefing,
   and the note under the chooser. */
export function paintTerms(){
  const d = currentTerms();
  const set = (id, txt)=>{ const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('order-terms', d.label);
  set('pause-terms', d.label);
  // The work order and the pause screen's briefing are one text printed twice, so both get the same numbers.
  const ret = proseClock(d.clock);
  const fix = `${d.repairTime} second${d.repairTime===1?'':'s'}`;
  set('order-return', ret);
  set('brief-return', ret);
  set('order-repair', fix);
  set('brief-repair', fix);
  const note = document.getElementById('note-difficulty');
  if (note){
    note.textContent = `${d.lives} lives \u00b7 ${Math.round(d.clock)}s on the clock \u00b7 ${d.repairTime}s at the pipe`;
  }
}

// Opens or closes the difficulty chooser on the work order screen.
export function setTermsOpen(v){
  termsOpen = v;
  const fold = document.getElementById('terms-fold');
  if (fold) fold.classList.toggle('open', v);
  if (!v){
    /* Keys held while the chooser was open must not carry into the run. The
       work order has no movement, so closing the chooser clears them. */
    clearInput();
  }
}