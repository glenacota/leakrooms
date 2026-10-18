import { FLOOR_CLOCK, REPAIR_TIME } from '../config/tuning.js';
import { DIFFICULTIES } from '../config/presets.js';
import { SETTINGS } from '../settings/store.js';
import { keys } from '../sim/keys.js';

/* ============================================================
   THE TERMS OF THE SHIFT
   The difficulty used to be a settings row the player could flip from the
   pause ticket, mid-run — which rewrote FLOOR_CLOCK, REPAIR_TIME and the
   hunt constants under a floor already being played, while runLives had
   been read at clock-in and stayed where it was. Now it is chosen at the
   door: the work order carries a stamp, CHANGE folds the chooser open on
   the ticket, and whatever the stamp says when CLOCK IN lands is what the
   run is built with. There is no difficulty control on the pause screen at
   all — a run is on its terms from its first frame.

   The value still lives in SETTINGS and still persists, so a returning
   player's stamp is the run they always play; a fresh machine reads NORMAL,
   the schema default, and is never unset. paintTerms is the one place the
   stamp is written, and syncSettingsUI calls it, so every path that can
   change the value — the chooser, the digits, RESET SETTINGS, a reloaded
   store — leaves the three stamps and the note saying the same thing.
   ============================================================ */
export let termsOpen = false;

/* The work order is prose, and prose needs prose numbers: 240 is "4 minutes",
   150 is "2 minutes 30 seconds", 90 is "90 seconds". The briefing used to say
   "3 minutes" and "5 seconds" whatever the terms — a lie on two of the three. */
export function proseClock(s){
  const m = Math.floor(s/60), r = Math.round(s%60);
  const mins = m ? `${m} minute${m===1?'':'s'}` : '';
  const secs = r ? `${r} second${r===1?'':'s'}` : '';
  return [mins, secs].filter(Boolean).join(' ') || 'no time at all';
}

export function paintTerms(){
  const d = DIFFICULTIES[SETTINGS.difficulty] || DIFFICULTIES.normal;
  const set = (id, txt)=>{ const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('order-terms', d.label);
  set('pause-terms', d.label);
  /* The work order and the pause reprint of it are one document written
     twice, so the numbers on both come from here: how long the shift is and
     how long a pipe takes, in the terms' own numbers. */
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

export function setTermsOpen(v){
  termsOpen = v;
  const fold = document.getElementById('terms-fold');
  if (fold) fold.classList.toggle('open', v);
  if (!v){
    /* The order screen has no movement, so a key held while the chooser was
       open must not carry into the run: closing the fold is the moment the
       frame goes back to being a splash, and splashes drop held keys. */
    for (const kk in keys) keys[kk] = false;
  }
}
