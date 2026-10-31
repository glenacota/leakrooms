import { emit } from '../util/events.js';
import { tickNoiseDecay } from './noise.js';

/**
 * Clock state bundle passed by reference.
 * @typedef {{
 *   time: number,
 *   clock: number,
 *   clockAnnounced: boolean,
 *   openLeaks: number,
 *   noise: number,
 *   selfNoise: number,
 *   ambientNoise: number,
 * }} ClockState
 */

/**
 * The level clock. It runs first in every step, because it can end the frame.
 * It does not stop while you repair, it does not stop while something stands
 * over you, and it does not reset when you seal a leak. Three minutes (on
 * NORMAL) cover finding the work, doing it, and walking back to the door, and
 * the walk back is where most of that time goes.
 *
 * The last 30 seconds are announced once, loudly, because a clock that only
 * lives in the corner of the HUD is one players ignore.
 *
 * Also advances the floor time and delegates noise decay to noise.js.
 *
 * @param {ClockState} clockState
 * @param {number} dt - seconds since the last step.
 * @returns {boolean} false when the clock ran out. The level is over and the
 *   caller must stop the frame there.
 */
export function tickClock(clockState, dt){
  clockState.time += dt;
  tickNoiseDecay(clockState, dt);

  clockState.clock = Math.max(0, clockState.clock - dt);
  if (clockState.clock <= 0){ emit('clock:out'); return false; }
  if (clockState.clock <= 30 && !clockState.clockAnnounced){
    clockState.clockAnnounced = true;
    const msg = clockState.openLeaks > 0
      ? 'THIRTY SECONDS \u2014 SEAL THE LEAK, THEN THE DOOR'
      : 'THIRTY SECONDS \u2014 GET TO THE DOOR';
    emit('flash', msg);
    emit('sfx', 'sting');
  }
  return true;
}