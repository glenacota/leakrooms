/* ============================================================
   THE FLOOD
   Water spreads from every open pipe along walkable floor at a fixed speed.
   That is the whole physics: no pressure model, no pooling.

   How it works:
   - A breadth-first search (BFS) measures each tile's walking distance from the
     NEAREST pipe (G.waterDist). It is computed once per floor.
   - The "front" is how far out the water has reached, so a tile's target
     wetness is simply "distance <= front".
   - Because the front is derived from elapsed time and not advanced by frame
     counts, two machines at different frame rates flood identically.
   - With several pipes, the search starts from all of them at once. Four pipes
     are one flood that started in four places, not four floods to reconcile.
   ============================================================ */

import { FLOOR, LEAK_HEADSTART, LEAK_RETREAT, LEAK_SPREAD, MAP_H, MAP_W, WET_EDGE, WET_FALL, WET_RISE } from '../config/constants.js';
import { G } from './state.js';
import { markWetTile, markWetAll } from '../render/repaint.js';

/* ---------- Flood data on G ----------
   G.wetArr      wetness per tile, 0 (dry) to 1 (standing water). One number
                 is shared by the renderer and the simulation, so the wet patch
                 you see is the wet patch that slows you down.
   G.waterDist   walking distance from the nearest pipe, per tile (-1 = unreachable)
   G.wetByDist   every reachable tile, in order of distance. A BFS produces this
                 order for free, so no sorting is needed.
   G.wetFront    how far out the water has reached, in tiles
   G.wetEdgeD    the furthest distance at which any tile is still visibly wet

   Why the ordering matters: scanning all 5776 tiles every frame is correct but
   far too slow (the bot playthrough alone simulates hundreds of thousands of
   frames). Everything that is wet is a contiguous PREFIX of G.wetByDist, so each
   frame only walks the part that can still change.

   Why wetEdgeD is not just the front: when the water starts to recede, the
   rings the front has already left are still drying, and they lie OUTSIDE the
   front. Stopping at the front would leave them stranded at full wetness. The
   edge covers those drying rings, and costs only a handful of rings extra. */

// BFS distance from the nearest pipe across floor. Computed once when a floor is built and read-only during play.
function floodField() {
  const d = new Int32Array(MAP_W * MAP_H).fill(-1);
  const q = [];
  for (const L of G.leaks) {
    if (L.fixed) continue;
    const s = L.sy * MAP_W + L.sx;
    if (d[s] >= 0) continue;
    d[s] = 0;
    q.push(s);
  }
  // A BFS visits tiles in non-decreasing distance, so q is already the G.wetByDist order.
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % MAP_W, cy = (c / MAP_W) | 0;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (G.grid[ni] !== FLOOR || d[ni] >= 0) continue;
      d[ni] = d[c] + 1;
      q.push(ni);
    }
  }
  return { dist: d, order: q };
}

/* Sets up the flood for a new floor, and pre-warms it (see below). Runs inside
   buildFloor. */
export function initFlood() {
  G.wetArr = new Float32Array(MAP_W * MAP_H);
  const ff = floodField();
  G.waterDist = ff.dist;
  G.wetByDist = ff.order;
  G.wetMaxDist = G.wetByDist.length ? G.waterDist[G.wetByDist[G.wetByDist.length - 1]] : 0;
  /* Lookup table: distance -> index of the first tile at or past that
     distance. Because the order is sorted, one pass builds it, and then the
     bound of the per-frame loop is just an array read. */
  G.wetIndexAtDist = new Int32Array(G.wetMaxDist + 2).fill(G.wetByDist.length);
  for (let n = G.wetByDist.length - 1; n >= 0; n--) {
    const d = G.waterDist[G.wetByDist[n]];
    if (d < G.wetIndexAtDist.length) G.wetIndexAtDist[d] = n;
  }
  for (let d = G.wetMaxDist - 1; d >= 0; d--) {
    if (G.wetIndexAtDist[d] > G.wetIndexAtDist[d + 1]) G.wetIndexAtDist[d] = G.wetIndexAtDist[d + 1];
  }
  G.wetFront = 0;
  G.wetSum = 0;
  G.wetEdgeD = -1;
  G.wetFloor = G.wetByDist.length;
  /* Start with the spawn room already damp. Otherwise the first seconds are a
     clean carpet with no clue, and the water looks like it switched on, not
     like it has been running all along. */
  seedSplash(G.player.x, G.player.y, 0.30);

  /* Pre-warm: set the flood directly to where it would be after
     LEAK_HEADSTART seconds. Simulating it would mean thousands of tickFlood
     calls on every floor build, and the end state is exactly "everything
     inside the front is fully wet". G.wetSum is added up in the same pass, so
     the sum and the array start in agreement. */
  {
    const front = Math.min(G.wetMaxDist, LEAK_HEADSTART / LEAK_SPREAD);
    G.wetFront = front;
    let sum = 0;
    // Every wet tile is within the front, so the edge is known exactly here.
    const hi = Math.min(G.wetByDist.length - 1,
                  G.wetIndexAtDist[Math.min(Math.ceil(front), G.wetIndexAtDist.length - 1)]);
    for (let n = 0; n <= hi; n++) {
      const i = G.wetByDist[n];
      if (G.waterDist[i] <= front) { G.wetArr[i] = 1; sum += 1; }
    }
    G.wetSum = sum;
    // The spawn puddle may reach past the pre-warmed front, so keep whichever reaches further.
    G.wetEdgeD = Math.max(G.wetEdgeD, Math.floor(front));
  }

  G.floodCover = G.wetFloor ? G.wetSum / G.wetFloor : 0;
  /* Flag the water image as stale. buildFloor can run in the middle of a frame
     (the door rebuilds the floor from update()), and the fresh image would
     otherwise be drawn as black over the new carpet for one frame. */
  markWetAll();
}

/* Drops a blob of water. Used to damp the spawn room, and to leave ripples
   behind the player while they wade, so moving through water leaves a trace. */
export function seedSplash(wx, wy, amount) {
  if (!G.wetArr) return;
  const cx = Math.floor(wx), cy = Math.floor(wy);
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
    const i = y * MAP_W + x;
    if (G.grid[i] !== FLOOR) continue;
    const dd = Math.hypot(x + 0.5 - wx, y + 0.5 - wy);
    const w = Math.min(1, Math.max(0, amount * (1 - dd / 1.8)));
    if (w > G.wetArr[i]) {
      G.wetSum += w - G.wetArr[i]; G.wetArr[i] = w;
      markWetTile(i);
      /* A splash can wet a tile beyond the flood's edge. The per-frame pass
         stops at the edge, so without this the tile would be a permanent damp
         spot that never dries. */
      if (w > WET_EDGE && G.waterDist[i] > G.wetEdgeD) G.wetEdgeD = G.waterDist[i];
    }
  }
}

/* How wet the ground is under a world point, 0 to 1. The movement code and the
   renderer both use it, so there is one answer to "how deep is the water here". */
export function wetAt(wx, wy) {
  if (!G.wetArr) return 0;
  const x = Math.floor(wx), y = Math.floor(wy);
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return 0;
  return G.wetArr[y * MAP_W + x];
}

/* How much of the reachable floor is wet, 0 to 1. This is the slow, obviously
   correct version (it sums every tile). The game does not call it: tickFlood
   keeps the same number up to date as it goes and stores it on G.floodCover.
   It is kept as the reference the tests compare the fast number against.

   The count is divided by the number of FLOOR tiles, not by the whole map,
   because most of the map is solid rock. */
export function floodCover() {
  if (!G.wetArr || !G.wetFloor) return 0;
  let s = 0;
  for (let i = 0; i < G.wetArr.length; i++) s += G.wetArr[i];
  return s / G.wetFloor;
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
 * @param {number} dt - seconds since the last step.
 */
export function tickFlood(dt) {
  if (!G.leaks.length || !G.wetArr) return;

  const prev = G.wetFront;
  const front = G.leaksOpen > 0
    ? Math.min(G.wetMaxDist, prev + dt / LEAK_SPREAD)
    : Math.max(0, prev - dt / LEAK_RETREAT);
  G.wetFront = front;
  /* A front that has stopped is not the same as settled water. The fade
     approaches zero but never quite arrives, so the only real "nothing to do"
     is an empty edge. Stopping when the front stops would leave the last
     rings of tiles a few percent wet for the rest of the level, and nothing
     would ever come back for them. */
  if (front === prev && G.wetEdgeD < 0) return;

  /* Every tile inside the front still moves toward its target, because a tile
     keeps darkening for WET_RISE seconds after the front passes it. An earlier
     version only updated the band the front had just swept, and left tiles
     stuck around 10% wet, so the floor looked permanently damp and not flooded.

     The bound is the larger of the wet edge and the front, so the drying rings
     outside the front are still visited (see the notes above floodField). */
  const boundD = Math.max(G.wetEdgeD, Math.ceil(Math.max(prev, front)));
  const hi = G.wetIndexAtDist[Math.min(boundD + 1, G.wetIndexAtDist.length - 1)] - 1;
  if (hi < 0) return;
  const tau = G.leaksOpen > 0 ? WET_RISE : WET_FALL;
  const k = 1 - Math.exp(-dt / tau);
  /* With the front at zero there is no water at all, including on the pipe's
     own standing tile. "distance <= front" would say otherwise for distance 0
     and leave a permanent damp patch under the pipe you just fixed. */
  const anyWater = front > 0;
  let sum = G.wetSum;
  let changed = false;
  // The new wet edge is worked out in the same loop, so no second scan is needed.
  let edge = -1;
  for (let n = 0; n <= hi; n++) {
    const i = G.wetByDist[n];
    const cur = G.wetArr[i];
    const target = (anyWater && G.waterDist[i] <= front) ? 1 : 0;
    // Unchanged tiles are still looked at, because the edge is derived from every tile in the range.
    if (cur !== target) {
      const next = cur + (target - cur) * k;
      /* A tile that has faded below the edge goes to exactly zero, and one very
         close to full goes to exactly one. A thousand tiles left at 1.2% would
         keep the flood gauge from ever reaching zero. */
      const snapped = target === 0 ? (next <= WET_EDGE ? 0 : next)
                                   : ((1 - next) < 0.004 ? 1 : next);
      // G.wetSum is kept up to date by adding the change, not by re-adding the array every frame.
      sum += snapped - cur;
      G.wetArr[i] = snapped;
      changed = true;
      markWetTile(i);
    }
    if (G.wetArr[i] > WET_EDGE) edge = G.waterDist[i];
  }
  G.wetEdgeD = edge;
  if (!changed) return;
  G.wetSum = sum;
  G.floodCover = G.wetFloor ? Math.max(0, sum / G.wetFloor) : 0;
}