import { dismissClear, retryFloor, runAgain, startRun, STATE } from '../game/run.js';
import { advanceSplash } from './splash.js';
import { setTermsOpen, termsOpen } from './terms.js';

/* ---------- buttons ---------- */
/* The wiring, not the work: each control calls the run function that owns it,
   and this function is the ONLY place any of it is attached. The screen
   listeners below used to exist here as well as inside bindButtons(), and a
   second copy is not a no-op: addEventListener appends, so one click on the
   riser ran advanceSplash() twice and skipped the work order. */
export function bindButtons(){
  document.getElementById('btn-start').onclick   = ()=>startRun();
  document.getElementById('btn-descend').onclick = ()=>dismissClear();
  document.getElementById('btn-retry').onclick   = ()=>retryFloor();
  document.getElementById('btn-again').onclick   = ()=>runAgain();

  /* Click anywhere on either splash advances it, so a player who never reads
     the keyboard prompt is not stuck. The listeners call the same advance the
     key chain does, so a click and a key cannot disagree about where the
     player is.

     Two guards, both for the work order now that it carries controls. A click
     that lands on a control — a term button, a slider, CHANGE, CLOCK IN itself
     — is a choice, not an advance: bubbling it up to the screen is how a
     player who meant to read the terms starts a run on HARD. And while the
     chooser is open, a click on the frame dismisses it the way ESC does,
     because an open chooser is the top layer of the screen. */
  for (const id of ['screen-splash','screen-order']){
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e)=>{
      if (e.target.closest && e.target.closest('button, input, .terms-fold')) return;
      if (STATE==='order' && termsOpen){ setTermsOpen(false); return; }
      advanceSplash();
    });
  }
}
