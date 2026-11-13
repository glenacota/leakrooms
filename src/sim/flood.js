/* ============================================================
   THE FLOOD
   Water spreads from every open leak along walkable floor at a fixed speed.
   That is the whole physics: no pressure model, no pooling.

   How it works:
   - A breadth-first search (BFS) measures each tile's walking distance from the
     NEAREST leak (waterDist). It is computed once per floor.
   - The "front" is how far out the water has reached, so a tile's target
     wetness is simply "distance <= front".
   - Because the front is derived from elapsed time and not advanced by frame
     counts, two machines at different frame rates flood identically.
   - With several leaks, the search starts from all of them at once. Four leaks
     are one flood that started in four places, not four floods to reconcile.
   - Each leak also keeps its own front and its own walking field.
     A tile is wet if some leak's front reaches it. While every
     pipe is open the fronts are identical, so this is the same flood as one
     front. Sealing a pipe only retreats that pipe's front, so water that other
     open pipes still reach stays put.
   ============================================================ */

import { FLOOR, LEAK_HEADSTART, LEAK_RETREAT, LEAK_SPREAD, MAP_H, MAP_W, WET_EDGE, WET_FALL, WET_RISE } from '../config/constants.js';
import { emit } from '../util/events.js';
import { hasOpenLeaks, openLeakSpots } from './leaks.js';
import { distanceField } from './path.js';

/**
 * Flood state bundle passed by reference.
 * @typedef {{
 *   grid: Uint8Array,
 *   leaks: Array<{x:number,y:number,sx:number,sy:number,fixed:boolean}>,
 *   openLeaks: number,
 *   waterDist: Int32Array|null,
 *   wetByDist: number[],
 *   wetFront: number,
 *   leakFront: number[],
 *   leakWaterDist: Array<Int32Array|null>,
 *   wetMaxDist: number,
 *   wetSum: number,
 *   wetEdgeD: number,
 *   wetIndexAtDist: Int32Array|null,
 *   wetArr: Float32Array,
 *   wetFloor: number,
 *   floodCover: number
 * }} FloodState
 */

/**
 * Player state for flood (only position needed).
 * @typedef {{x:number, y:number}} FloodPlayerState
 */

/* Sets up the flood for a new floor, and pre-warms it. Runs inside buildFloor. */
export function initFlood(floodState, player) {
  floodState.wetArr = new Float32Array(MAP_W * MAP_H);
  const sources = openLeakSpots(floodState);
  const ff = distanceField(floodState.grid, sources);
  floodState.waterDist = ff.dist;
  floodState.wetByDist = ff.order;
  floodState.wetMaxDist = floodState.wetByDist.length ? floodState.waterDist[floodState.wetByDist[floodState.wetByDist.length - 1]] : 0;
  /* Lookup table: distance -> index of the first tile at or past that
     distance. Because the order is sorted, one pass builds it, and then the
     bound of the per-frame loop is just an array read. */
  floodState.wetIndexAtDist = new Int32Array(floodState.wetMaxDist + 2).fill(floodState.wetByDist.length);
  for (let n = floodState.wetByDist.length - 1; n >= 0; n--) {
    const d = floodState.waterDist[floodState.wetByDist[n]];
    if (d < floodState.wetIndexAtDist.length) floodState.wetIndexAtDist[d] = n;
  }
  for (let d = floodState.wetMaxDist - 1; d >= 0; d--) {
    if (floodState.wetIndexAtDist[d] > floodState.wetIndexAtDist[d + 1]) floodState.wetIndexAtDist[d] = floodState.wetIndexAtDist[d + 1];
  }
  floodState.wetFront = 0;
  floodState.wetSum = 0;
  floodState.wetEdgeD = -1;
  floodState.wetFloor = floodState.wetByDist.length;
  /* Start with the spawn room already damp. */
  seedSplash(floodState, player.x, player.y, 0.30);

  /* Pre-warm: set the flood directly to where it would be after LEAK_HEADSTART
     seconds. The end state is exactly "everything inside the front is fully
     wet". wetSum is added up in the same pass, so the sum and the array start
     in agreement. */
  {
    const front = Math.min(floodState.wetMaxDist, LEAK_HEADSTART / LEAK_SPREAD);
    /* Every open pipe starts at the same front. The union of their walking
       fields is then exactly the nearest-leak field this function already built,
       so the pre-warm, and the golden floor's coverage, do not move. */
    floodState.leakFront = floodState.leaks.map(L => (L.fixed ? 0 : front));
    floodState.leakWaterDist = floodState.leaks.map(L =>
      (L.fixed ? null : distanceField(floodState.grid, [L.sy * MAP_W + L.sx]).dist));
    floodState.wetFront = front;
    let sum = 0;
    // Every wet tile is within the front, so the edge is known exactly here.
    const hi = Math.min(floodState.wetByDist.length - 1,
                  floodState.wetIndexAtDist[Math.min(Math.ceil(front), floodState.wetIndexAtDist.length - 1)]);
    for (let n = 0; n <= hi; n++) {
      const i = floodState.wetByDist[n];
      if (leakReaches(floodState, i)) { floodState.wetArr[i] = 1; sum += 1; }
    }
    floodState.wetSum = sum;
    // The spawn puddle may reach past the pre-warmed front, so keep whichever
    // reaches further.
    floodState.wetEdgeD = Math.max(floodState.wetEdgeD, Math.floor(front));
  }

  floodState.floodCover = floodState.wetFloor ? floodState.wetSum / floodState.wetFloor : 0;
  emit('waterChanged');
}

/* Drops a blob of water. Used to damp the spawn room, and to leave ripples
   behind the player while they wade, so moving through water leaves a trace. */
export function seedSplash(floodState, wx, wy, amount) {
  if (!floodState.wetArr) return;
  const cx = Math.floor(wx), cy = Math.floor(wy);
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
    const i = y * MAP_W + x;
    if (floodState.grid[i] !== FLOOR) continue;
    const dd = Math.hypot(x + 0.5 - wx, y + 0.5 - wy);
    const w = Math.min(1, Math.max(0, amount * (1 - dd / 1.8)));
    if (w > floodState.wetArr[i]) {
      floodState.wetSum += w - floodState.wetArr[i]; floodState.wetArr[i] = w;
      emit('tileChanged', i);
      if (w > WET_EDGE && floodState.waterDist[i] > floodState.wetEdgeD) floodState.wetEdgeD = floodState.waterDist[i];
    }
  }
}

/* How wet the ground is under a world point, 0 to 1. The movement code and the
   renderer both use it, so there is one answer to "how deep is the water here". */
export function wetAt(floodState, wx, wy) {
  if (!floodState.wetArr) return 0;
  const x = Math.floor(wx), y = Math.floor(wy);
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return 0;
  return floodState.wetArr[y * MAP_W + x];
}

/* True when a leak whose front is still moving reaches tile i. "Still moving"
   means open, or sealed but not yet dry. A front at zero reaches nothing, so
   the pipe's own standing tile is not wet until its front has actually started. */
function leakReaches(floodState, i) {
  const fronts = floodState.leakFront;
  for (let k = 0; k < fronts.length; k++) {
    if (fronts[k] <= 0) continue;
    const field = floodState.leakWaterDist[k];
    const d = field ? field[i] : -1;
    if (d >= 0 && d <= fronts[k]) return true;
  }
  return false;
}

/**
 * Advances the water by one step.
 *
 * Each open pipe pushes its front out at LEAK_SPREAD. A sealed pipe pulls its
 * own front back in at LEAK_RETREAT, from wherever it stood when sealed. Going
 * in is much faster than coming out, or the floor would still be draining long
 * after the work is done. The recession stays radial: each front is measured
 * from its pipe, so water pulls back toward that pipe and not as a uniform fade.
 * Water another open pipe still reaches does not move.
 *
 * Wetness moves toward its target with a time constant, so the waterline creeps
 * instead of jumping a tile at a time, and a tile the front just passed is only
 * part wet.
 *
 * @param {FloodState} floodState
 * @param {number} dt - seconds since the last step.
 */
export function tickFlood(floodState, dt) {
  if (!floodState.leaks.length || !floodState.wetArr) return;

  const open = hasOpenLeaks(floodState);
  const fronts = floodState.leakFront;
  const prevMax = floodState.wetFront;
  let newMax = 0, moved = false;
  for (let k = 0; k < fronts.length; k++) {
    const prev = fronts[k];
    const next = floodState.leaks[k].fixed
      ? Math.max(0, prev - dt / LEAK_RETREAT)
      : Math.min(floodState.wetMaxDist, prev + dt / LEAK_SPREAD);
    if (next !== prev) moved = true;
    fronts[k] = next;
    if (next > newMax) newMax = next;
  }
  floodState.wetFront = newMax;
  if (!moved && floodState.wetEdgeD < 0) return;

  /* Every tile inside a front still moves toward its target, because a tile
     keeps darkening for WET_RISE seconds after the front passes it.

     The bound is the larger of the wet edge and the furthest front, so the
     drying rings outside the front are still visited. */
  const boundD = Math.max(floodState.wetEdgeD, Math.ceil(Math.max(prevMax, newMax)));
  const hi = floodState.wetIndexAtDist[Math.min(boundD + 1, floodState.wetIndexAtDist.length - 1)] - 1;
  if (hi < 0) return;
  const tau = open ? WET_RISE : WET_FALL;
  const k = 1 - Math.exp(-dt / tau);
  let sum = floodState.wetSum;
  let changed = false;
  // The new wet edge is worked out in the same loop, so no second scan is needed.
  let edge = -1;
  for (let n = 0; n <= hi; n++) {
    const i = floodState.wetByDist[n];
    const cur = floodState.wetArr[i];
    const target = leakReaches(floodState, i) ? 1 : 0;
    // Unchanged tiles are still looked at, because the edge is derived from every tile in the range.
    if (cur !== target) {
      const next = cur + (target - cur) * k;
      /* A tile that has faded below the edge goes to exactly zero, and one very
         close to full goes to exactly one. */
      const snapped = target === 0 ? (next <= WET_EDGE ? 0 : next)
                                   : ((1 - next) < 0.004 ? 1 : next);
      sum += snapped - cur;
      floodState.wetArr[i] = snapped;
      changed = true;
      emit('tileChanged', i);
    }
    if (floodState.wetArr[i] > WET_EDGE) edge = floodState.waterDist[i];
  }
  floodState.wetEdgeD = edge;
  if (!changed) return;
  floodState.wetSum = sum;
  floodState.floodCover = floodState.wetFloor ? Math.max(0, sum / floodState.wetFloor) : 0;
}