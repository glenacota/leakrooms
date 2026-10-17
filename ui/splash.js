import { Audio_ } from '../src/audio/index.js';
import { RUN_SEED, setState, STATE } from '../game/run.js';
import { setTermsOpen } from './terms.js';
import { show } from './dom.js';

/* The bed follows STATE, not the individual screens. It is keyed off the names
   rather than off `show()` because `show()` is also how the pause screen comes
   up, and a title drone leaking into a pause menu is the sort of thing nobody
   reports and everybody notices.

   The floor-clear card is a menu like the other two: the room hum keeps
   running under it. What stops there is the FLOOR — acclaim() kills the leak
   and noise beds, which belong to the level that just ended. */
export function syncAmbience(){
  Audio_.ambience(STATE==='splash' || STATE==='order' || STATE==='clear');
}

export function advanceSplash(){
  Audio_.unlock();
  if (STATE==='splash'){
    setState('order');
    /* The seed goes on the stub so each run's ticket reads as authored
       rather than generated. It is RUN_SEED — the same number that builds
       the floor when the player clocks in — so it is not decoration. */
    const seedEl = document.getElementById('order-seed');
    if (seedEl) seedEl.textContent = '#88D-' + (RUN_SEED>>>0).toString(16).toUpperCase().slice(-4);
    show('order');
  } else if (STATE==='order'){
    /* The chooser folds itself shut on the way in: the next time this ticket
       is seen — after a death, or a finished run — it should show the stamped
       terms, not last boot's open fold. */
    setTermsOpen(false);
    document.getElementById('btn-start').click();
  }
  syncAmbience();
}
export function backSplash(){
  Audio_.unlock();
  if (STATE==='order'){ setState('splash'); show('splash'); syncAmbience(); return true; }
  return false;                       // nothing behind splash 03: it is the first frame
}
