/* ============================================================
   THE FLOOD
   Water spreads from every open pipe along walkable floor at a fixed speed.
   That is the whole physics: no pressure model, no pooling.

   How it works:
   - A breadth-first search (BFS) measures each tile's walking distance from the
     NEAREST pipe (waterDist). It is computed once per floor.
   - The "front" is how far out the water has reached, so a tile's target
     wetness is simply "distance <= front".
   - Because the front is derived from elapsed time and not advanced by frame
     counts, two machines at different frame rates flood identically.
   - With several pipes, the search starts from all of them at once. Four pipes
     are one flood that started in four places, not four floods to reconcile.
   ============================================================ */

import { FLOOR, LEAK_HEADSTART, LEAK_RETREAT, LEAK_SPREAD, MAP_H, MAP_W, WET_EDGE, WET_FALL, WET_RISE } from '../config/constants.js';
import { markWetTile, markWetAll } from '../render/repaint.js';

/**
 * Flood state bundle passed by reference.
 * @typedef {{
 *   grid: Uint8Array,
 *   leaks: Array<{x:number,y:number,sx:number,sy:number,fixed:boolean}>,
 *   leaksOpen: number,
 *   waterDist: Int32Array|null,
 *   wetByDist: number[],
 *   wetFront: number,
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

// BFS distance from the nearest pipe across floor. Computed once when a floor is built and read-only during play.
function floodField(grid, leaks) {
  const d = new Int32Array(MAP_W * MAP_H).fill(-1);
  const q = [];
  for (const L of leaks) {
    if (L.fixed) continue;
    const s = L.sy * MAP_W + L.sx;
    if (d[s] >= 0) continue;
    d[s] = 0;
    q.push(s);
  }
  // A BFS visits tiles in non-decreasing distance, so q is already the wetByDist order.
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % MAP_W, cy = (c / MAP_W) | 0;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (grid[ni] !== FLOOR || d[ni] >= 0) continue;
      d[ni] = d[c] + 1;
      q.push(ni);
    }
  }
  return { dist: d, order: q };
}

/* Sets up the flood for a new floor, and pre-warms it. Runs inside buildFloor. */
export function initFlood(floodState, player) {
  floodState.wetArr = new Float32Array(MAP_W * MAP_H);
  const ff = floodField(floodState.grid, floodState.leaks);
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
  /* Start with the spawn room already damp. Otherwise the first seconds are a
     clean carpet with no clue, and the water looks like it switched on, not
     like it has been running all along. */
  seedSplash(floodState, player.x, player.y, 0.30);

  /* Pre-warm: set the flood directly to where it would be after
     LEAK_HEADSTART seconds. Simulating it would mean thousands of tickFlood
     calls on every floor build, and the end state is exactly "everything
     inside the front is fully wet". wetSum is added up in the same pass, so
     the sum and the array start in agreement. */
  {
    const front = Math.min(floodState.wetMaxDist, LEAK_HEADSTART / LEAK_SPREAD);
    floodState.wetFront = front;
    let sum = 0;
    // Every wet tile is within the front, so the edge is known exactly here.
    const hi = Math.min(floodState.wetByDist.length - 1,
                  floodState.wetIndexAtDist[Math.min(Math.ceil(front), floodState.wetIndexAtDist.length - 1)]);
    for (let n = 0; n <= hi; n++) {
      const i = floodState.wetByDist[n];
      if (floodState.waterDist[i] <= front) { floodState.wetArr[i] = 1; sum += 1; }
    }
    floodState.wetSum = sum;
    // The spawn puddle may reach past the pre-warmed front, so keep whichever reaches further.
    floodState.wetEdgeD = Math.max(floodState.wetEdgeD, Math.floor(front));
  }

  floodState.floodCover = floodState.wetFloor ? floodState.wetSum / floodState.wetFloor : 0;
  /* Flag the water image as stale. buildFloor can run in the middle of a frame
     (the door rebuilds the floor from update()), and the fresh image would
     otherwise be drawn as black over the new carpet for one frame. */
  markWetAll();
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
      markWetTile(i);
      /* A splash can wet a tile beyond the flood's edge. The per-frame pass
         stops at the edge, so without this the tile would be a permanent damp
         spot that never dries. */
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

/* How much of the reachable floor is wet, 0 to 1. This is the slow, obviously
   correct version (it sums every tile). The game does not call it: tickFlood
   keeps the same number up to date as it goes and stores it on floodState.floodCover.
   It is kept as the reference the tests compare the fast number against.

   The count is divided by the number of FLOOR tiles, not by the whole map,
   because most of the map is solid rock. */
export function floodCover(floodState) {
  if (!floodState.wetArr || !floodState.wetFloor) return 0;
  let s = 0;
  for (let i = 0; i < floodState.wetArr.length; i++) s += floodState.wetArr[i];
  return s / floodState.wetFloor;
}

/**
 * Advances the water by one step.
 *
 * The front moves out while any pipe is open, and back in once every pipe is
 * sealed. Going in is much faster than coming out (LEAK_RETREAT against
 * LEAK_SPREAD), or the floor would still be draining long after the work is done.
 * The recession stays radial: it is derived from the front, so water pulls back
 * from the edges toward the pipes and not as a uniform fade.
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

  const prev = floodState.wetFront;
  const front = floodState.leaksOpen > 0
    ? Math.min(floodState.wetMaxDist, prev + dt / LEAK_SPREAD)
    : Math.max(0, prev - dt / LEAK_RETREAT);
  floodState.wetFront = front;
  /* A front that has stopped is not the same as settled water. The fade
     approaches zero but never quite arrives, so the only real "nothing to do"
     is an empty edge. Stopping when the front stops would leave the last
     rings of tiles a few percent wet for the rest of the level, and nothing
     would ever come back for them. */
  if (front === prev && floodState.wetEdgeD < 0) return;

  /* Every tile inside the front still moves toward its target, because a tile
     keeps darkening for WET_RISE seconds after the front passes it. An earlier
     version only updated the band the front had just swept, and left tiles
     stuck around 10% wet, so the floor looked permanently damp and not flooded.

     The bound is the larger of the wet edge and the front, so the drying rings
     outside the front are still visited (see the notes above floodField). */
  const boundD = Math.max(floodState.wetEdgeD, Math.ceil(Math.max(prev, front)));
  const hi = floodState.wetIndexAtDist[Math.min(boundD + 1, floodState.wetIndexAtDist.length - 1)] - 1;
  if (hi < 0) return;
  const tau = floodState.leaksOpen > 0 ? WET_RISE : WET_FALL;
  const k = 1 - Math.exp(-dt / tau);
  /* With the front at zero there is no water at all, including on the pipe's
     own standing tile. "distance <= front" would say otherwise for distance 0
     and leave a permanent damp patch under the pipe you just fixed. */
  const anyWater = front > 0;
  let sum = floodState.wetSum;
  let changed = false;
  // The new wet edge is worked out in the same loop, so no second scan is needed.
  let edge = -1;
  for (let n = 0; n <= hi; n++) {
    const i = floodState.wetByDist[n];
    const cur = floodState.wetArr[i];
    const target = (anyWater && floodState.waterDist[i] <= front) ? 1 : 0;
    // Unchanged tiles are still looked at, because the edge is derived from every tile in the range.
    if (cur !== target) {
      const next = cur + (target - cur) * k;
      /* A tile that has faded below the edge goes to exactly zero, and one very
         close to full goes to exactly one. A thousand tiles left at 1.2% would
         keep the flood gauge from ever reaching zero. */
      const snapped = target === 0 ? (next <= WET_EDGE ? 0 : next)
                                   : ((1 - next) < 0.004 ? 1 : next);
      // wetSum is kept up to date by adding the change, not by re-adding the array every frame.
      sum += snapped - cur;
      floodState.wetArr[i] = snapped;
      changed = true;
      markWetTile(i);
    }
    if (floodState.wetArr[i] > WET_EDGE) edge = floodState.waterDist[i];
  }
  floodState.wetEdgeD = edge;
  if (!changed) return;
  floodState.wetSum = sum;
  floodState.floodCover = floodState.wetFloor ? Math.max(0, sum / floodState.wetFloor) : 0;
}