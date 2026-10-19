import { Audio_ } from '../audio/index.js';
import { RUN_SEED, setState, startRun, STATE } from '../game/run.js';
import { setTermsOpen } from './terms.js';
import { show } from './dom.js';

/* Starts or stops the ambient room sound to match the current state. It
   follows STATE and not the individual screens, because show() is also how the
   pause screen appears, and the title sound must not leak into the pause menu.

   The floor clear card counts as a menu: the room hum keeps playing under it.
   What stops there is the level's own sound (the leak and noise beds), which
   is closed by the 'state' event. */
export function syncAmbience(){
  Audio_.ambience(STATE==='splash' || STATE==='order' || STATE==='clear');
}

/* Moves one step forward: title to work order, then work order to the run.
   Called by key presses, clicks and ENTER, so all three behave the same. */
export function advanceSplash(){
  Audio_.unlock();
  if (STATE==='splash'){
    setState('order');
    /* Show the run seed on the ticket's stub. It is the same number that
       builds the floor when the player clocks in. */
    const seedEl = document.getElementById('order-seed');
    if (seedEl) seedEl.textContent = '#88D-' + (RUN_SEED>>>0).toString(16).toUpperCase().slice(-4);
    show('order');
  } else if (STATE==='order'){
    // Close the difficulty chooser on the way in, so the next time this ticket is seen it shows the chosen terms and not an open fold.
    setTermsOpen(false);
    startRun();
  }
  syncAmbience();
}

// ESC: one step back (work order to title). Returns false when there is nothing behind the current screen.
export function backSplash(){
  Audio_.unlock();
  if (STATE==='order'){ setState('splash'); show('splash'); syncAmbience(); return true; }
  return false;
}