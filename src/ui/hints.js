import { LOUD } from '../config/constants.js';
import { STATE } from '../game/run.js';
import { G } from '../sim/state.js';
import { on } from '../util/events.js';
import { flash } from './hud.js';

const announced = new Set();

/** Flashes once when the player's own noise first crosses LOUD in a run. */
export function tickLoudFlash(){
  if (!announced.has('LOUD') && G && G.selfNoise >= LOUD){
    announced.add('LOUD');
    flash('LOUD — IT CAN HEAR THAT');
  }
}

/** Wires the stealth hints and resets their once-per-run announcements. */
export function bindHints(){
  on('state', () => { if (STATE === 'splash') announced.clear(); });
  on('heard', ({ to }) => {
    const msg = to === 'RISING' ? 'SOMETHING WOKE UP'
      : to === 'SEARCH' ? 'IT HEARD THAT'
      : to === 'HUNT' ? "IT'S COMING"
      : null;
    if (msg && !announced.has(to)){
      announced.add(to);
      flash(msg);
    }
  });
}
