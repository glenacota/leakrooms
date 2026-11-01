/* ============================================================
   THE PAUSE SCREEN
   Pausing opens the binder in pause mode: a RUN page with the live numbers of
   the shift, then the same FIELD MANUAL and SETTINGS pages as before the
   shift. A pause lands on RUN.

   Settings take effect immediately. There is no apply button, because the
   values are cheap and reversible and a delayed apply makes people wonder
   whether the change was saved.

   STATE stays 'pause' the whole time. Only the binder tab changes, so the
   clock stays frozen and there is no second state machine to keep in step.
   ============================================================ */

import { FLOORS } from '../config/tuning.js';
import { currentTerms } from '../settings/store.js';
import { G } from '../sim/state.js';
import { clockText, disarmReset, STATE, transition } from '../game/run.js';
import { livesHTML } from './hud.js';
import { openBinder } from './binder.js';

// ESC or ENTER: pauses a running game, or resumes a paused one.
export function togglePause(){
  if (STATE==='play'){
    /* transition() handles everything a state change needs: the screen, the
       HUD, held keys, and (through the 'state' event) the audio beds and the
       audio context. */
    transition('pause');
    openBinder('pause', 'run');
    /* The run's numbers on the RUN page, so pausing does not cost the player
       their bearings. Every id below is in index.html. */
    const set = (id, html)=>{ const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const sealed = G.totalLeaks - G.openLeaks;

    set('pause-floor',  `${G.floor+1}/${FLOORS}`);
    set('pause-clock',   clockText(G.clock));
    set('pause-leaks',  `${sealed}/${G.totalLeaks}`);
    set('pause-lives', livesHTML());
    // The terms are shown as a fact. They cannot be changed from here.
    set('pause-terms',  currentTerms().label);
  }
  else if (STATE==='pause'){ disarmReset(); transition('play'); }
}
