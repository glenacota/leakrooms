import { dismissClear, retryFloor, runAgain, startRun, STATE } from '../game/run.js';
import { advanceSplash } from './splash.js';
import { togglePause } from './pause.js';
import { setTermsOpen, termsOpen } from './terms.js';
import { toggleFullscreen, dismissHint } from './fullscreen.js';

/* Attaches the buttons and screen clicks to the run functions that do the
   work. This function is the only place where that wiring happens. Adding the
   same listener twice is not harmless: one click on the title screen would
   advance twice and skip the work order. */
export function bindButtons(){
  document.getElementById('btn-start').onclick   = ()=>startRun();
  document.getElementById('btn-descend').onclick = ()=>dismissClear();
  document.getElementById('btn-retry').onclick   = ()=>retryFloor();
  document.getElementById('btn-again').onclick   = ()=>runAgain();
  /* The pause screen's way back into the run for a player with no ESC key.
     It only acts on the pause screen: togglePause() would also START a pause
     from play, which a RESUME button must never do. */
  document.getElementById('btn-resume').onclick  = ()=>{ if (STATE==='pause') togglePause(); };

  /* The fullscreen button and the tip's dismiss buttons. Both are touch-only
     and both act on click, which is the gesture fullscreen needs. */
  document.getElementById('btn-fullscreen').onclick = ()=>{ toggleFullscreen(); };
  for (const id of ['btn-hint-title','btn-hint-pause'])
    document.getElementById(id).onclick = ()=>dismissHint();

  /* Clicking the BEGIN SHIFT button on the work order screen starts the run.
     Clicking anywhere else on the title or work order screen does nothing.
     Clicking on a control (button, slider, difficulty chooser) is a choice and
     not an advance. While the difficulty chooser is open, a click on the
     background closes it, the same as ESC. */
  for (const id of ['screen-splash','screen-order']){
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e)=>{
      if (e.target.closest && e.target.closest('button, input, .terms-fold')) return;
      if (STATE==='order' && termsOpen){ setTermsOpen(false); return; }
      if (STATE==='splash') advanceSplash();
    });
  }
}