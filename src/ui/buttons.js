import { dismissClear, retryFloor, runAgain, startRun, STATE } from '../game/run.js';
import { advanceSplash } from './splash.js';
import { setTermsOpen, termsOpen } from './terms.js';

/* Attaches the buttons and screen clicks to the run functions that do the
   work. This function is the only place where that wiring happens. Adding the
   same listener twice is not harmless: one click on the title screen would
   advance twice and skip the work order. */
export function bindButtons(){
  document.getElementById('btn-start').onclick   = ()=>startRun();
  document.getElementById('btn-descend').onclick = ()=>dismissClear();
  document.getElementById('btn-retry').onclick   = ()=>retryFloor();
  document.getElementById('btn-again').onclick   = ()=>runAgain();

  /* Clicking anywhere on the title or work order screen advances it, so a
     player who never reads the keyboard hint is not stuck. It uses the same
     advanceSplash() as the key handler, so a click and a key cannot disagree.

     Two guards:
       1. A click on a control (a button, a slider, the difficulty chooser) is
          a choice and not an advance. Letting it bubble up would start a run on
          HARD for someone who only meant to read the difficulty options.
       2. While the difficulty chooser is open, a click on the background
          closes it, the same as ESC. */
  for (const id of ['screen-splash','screen-order']){
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e)=>{
      if (e.target.closest && e.target.closest('button, input, .terms-fold')) return;
      if (STATE==='order' && termsOpen){ setTermsOpen(false); return; }
      advanceSplash();
    });
  }
}