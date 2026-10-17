import { dismissClear, retryFloor, runAgain, startRun, STATE } from '../game/run.js';
import { advanceSplash } from './splash.js';
import { setTermsOpen, termsOpen } from './terms.js';

/* Click anywhere on either splash advances it, so a player who never reads
   the keyboard prompt is not stuck. The advance function keys off STATE, so
   the click that lands on CLOCK IN and then bubbles up to the screen a second
   time finds STATE already 'play' and does nothing.

   Two guards, both for the work order now that it carries controls. A click
   that lands on a control — a term button, a slider, CHANGE, CLOCK IN itself —
   is a choice, not an advance: bubbling it up to the screen is how a player
   who meant to read the terms starts a run on HARD. And while the chooser
   is open, a click on the frame dismisses it the way ESC does, because an
   open chooser is the top layer of the screen. */
for (const id of ['screen-splash','screen-order']){
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', (e)=>{
    if (e.target.closest && e.target.closest('button, input, .terms-fold')) return;
    if (STATE==='order' && termsOpen){ setTermsOpen(false); return; }
    advanceSplash();
  });
}
/* ---------- buttons ---------- */
/* The wiring, not the work: each control calls the run function that owns it. */
document.getElementById('btn-start').onclick   = ()=>startRun();
document.getElementById('btn-descend').onclick = ()=>dismissClear();
document.getElementById('btn-retry').onclick   = ()=>retryFloor();
document.getElementById('btn-again').onclick   = ()=>runAgain();

/* Every control that starts, rewinds or continues a run, plus the two screens
   that advance on a click anywhere. The buttons call the run functions; the
   screen listeners call the same advance the key chain does, so a click and a
   key cannot disagree about where the player is. */
export function bindButtons(){
  document.getElementById('btn-start').onclick   = ()=>startRun();
  document.getElementById('btn-descend').onclick = ()=>dismissClear();
  document.getElementById('btn-retry').onclick   = ()=>retryFloor();
  document.getElementById('btn-again').onclick   = ()=>runAgain();

  for (const id of ['screen-splash','screen-order']){
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e)=>{
      if (e.target.closest && e.target.closest('button, input, .terms-fold')) return;
      if (STATE==='order' && termsOpen){ setTermsOpen(false); return; }
      advanceSplash();
    });
  }
}
