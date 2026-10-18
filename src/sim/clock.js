import { emit } from '../util/events.js';
import { G } from './state.js';

/**
 * The level clock. It runs first in every step, because it can end the frame.
 * It does not stop while you repair, it does not stop while something stands
 * over you, and it does not reset when you seal a pipe. Three minutes (on
 * NORMAL) cover finding the work, doing it, and walking back to the door, and
 * the walk back is where most of that time goes.
 *
 * The last 30 seconds are announced once, loudly, because a clock that only
 * lives in the corner of the HUD is one players ignore.
 *
 * Also advances the floor time and decays the noise meters.
 *
 * @param {number} dt - seconds since the last step.
 * @returns {boolean} false when the clock ran out. The level is over and the
 *   caller must stop the frame there.
 */
export function tickClock(dt){
  G.time += dt;
  G.noise = Math.max(0, G.noise - dt*1.55);
  // The player's own noise decays at the same rate as the total, so the yellow part of the bar empties as fast as the building's hiss appears under it.
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