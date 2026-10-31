/* ============================================================
   PULSE REACH
   The geometry behind the sound pulses. A pulse is a ring left where a sound
   was made. Each ray from the sound stops at the first wall it meets, so the
   ring shows cover: a wall cuts the sound short on that side.

   Pure simulation data, so the renderer can ask for it and the tests can check
   it without a canvas. The grid is read only.
   ============================================================ */

import { MAP_H, MAP_W, WALL } from '../config/constants.js';
import { hearRadius } from './noise.js';

/* How many directions a pulse is traced in. 48 gives a 7.5 degree gap between
   rays, which is finer than a wall corner looks at this scale. */
export const PULSE_RAYS = 48;
/* How far a ray steps per check, in tiles. Small enough that a ray cannot
   skip a one-tile wall. */
const STEP = 0.1;
/* The sim runs at a fixed 1/60 s. A steady sound repeats every PULSE_TICKS
   ticks: 30 ticks is half a second, close to the footstep beat. Counting ticks
   keeps the cadence deterministic and needs no dt. */
export const PULSE_TICKS = 30;

/**
 * How far a sound of this power reaches in each of PULSE_RAYS directions,
 * stopped at the first wall. Ray i points at angle 2*PI*i/PULSE_RAYS.
 *
 * Walls are treated as cover for the ring only. The sound's own wall cost
 * (NOISE.WALL_COST) still applies in the lifeforms' hearing, which is a
 * separate check in noise.js.
 *
 * @param {Uint8Array} grid
 * @param {number} x - sound origin, in tiles.
 * @param {number} y
 * @param {number} power - the sound's noise power.
 * @returns {Float32Array} distance in tiles per ray.
 */
export function pulseReach(grid, x, y, power){
  const R = hearRadius(power);
  const out = new Float32Array(PULSE_RAYS);
  for (let i = 0; i < PULSE_RAYS; i++){
    const a = (i / PULSE_RAYS) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    let d = R;
    for (let t = STEP; t <= R; t += STEP){
      const tx = Math.floor(x + c*t), ty = Math.floor(y + s*t);
      // Off the map counts as a wall, so a ring never leaves the level.
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || grid[ty*MAP_W + tx] === WALL){
        d = t - STEP;
        break;
      }
    }
    out[i] = d;
  }
  return out;
}

/**
 * Counts down a steady sound's pulse timer by one tick. Returns true on the
 * tick a pulse is due and restarts the count. A holder with no timer yet
 * (undefined) pulses at once.
 *
 * @param {{pulseTicks?: number}} holder - an object that owns the timer.
 * @returns {boolean}
 */
export function pulseDue(holder){
  holder.pulseTicks = (holder.pulseTicks || 0) - 1;
  if (holder.pulseTicks <= 0){
    holder.pulseTicks = PULSE_TICKS;
    return true;
  }
  return false;
}
