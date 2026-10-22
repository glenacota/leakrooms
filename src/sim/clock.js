import { emit } from '../util/events.js';

/**
 * Clock state bundle passed by reference.
 * @typedef {{
 *   time: number,
 *   clock: number,
 *   clockAnnounced: boolean,
 *   noise: number,
 *   selfNoise: number,
 *   ambientNoise: number,
 * }} ClockState
 */

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
 * @param {ClockState} clockState
 * @param {number} dt - seconds since the last step.
 * @returns {boolean} false when the clock ran out. The level is over and the
 *   caller must stop the frame there.
 */
export function tickClock(clockState, dt){
  clockState.time += dt;
  clockState.noise = Math.max(0, clockState.noise - dt*1.55);
  // The player's own noise decays at the same rate as the total, so the yellow part of the bar empties as fast as the building's hiss appears under it.
  clockState.selfNoise = Math.max(0, clockState.selfNoise - dt*1.55);
  clockState.ambientNoise = Math.max(0, clockState.ambientNoise - dt*1.55);

  clockState.clock = Math.max(0, clockState.clock - dt);
  if (clockState.clock <= 0){ emit('clock:out'); return false; }
  if (clockState.clock <= 30 && !clockState.clockAnnounced){
    clockState.clockAnnounced = true;
    emit('flash', 'THIRTY SECONDS \u2014 THE WATER IS AT YOUR FEET');
    emit('sfx', 'sting', );
  }
  return true;
}