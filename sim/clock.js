import { emit } from '../util/events.js';
import { G } from './state.js';

/* --- THE CLOCK ---
   Runs before everything, and it is the only thing on this level that cannot
   be argued with. It does not stop while you wrench, it does not stop while
   something is standing over you, and it does not reset because you sealed a
   pipe. Three minutes to find the work, do the work, and walk all the way back
   to the door you came in through — and every second of it is spent on the
   return trip, which is why the return trip is the part the level is about.

   The last thirty seconds are announced once, loudly, because a clock that is
   only ever visible in a corner of the HUD is a clock most players will watch
   the ceiling instead.

   Returns false when the clock has run out: the level is over and the caller
   must stop the frame there, exactly as it did when this code sat inline. */
export function tickClock(dt){
  G.time += dt;
  G.noise = Math.max(0, G.noise - dt*1.55);
  /* The player's own share decays on exactly the same curve as the total, so the
     yellow part of the bar empties at the rate the building's hiss appears
     under it rather than at a rate of its own invention. */
  G.selfNoise = Math.max(0, G.selfNoise - dt*1.55);

  G.clock = Math.max(0, G.clock - dt);
  if (G.clock <= 0){ emit('clock:out'); return false; }
  if (G.clock <= 30 && !G.clockAnnounced){
    G.clockAnnounced = true;
    emit('flash', 'THIRTY SECONDS \u2014 THE WATER IS AT YOUR FEET');
    emit('sfx', 'sting', );
  }
  return true;
}
