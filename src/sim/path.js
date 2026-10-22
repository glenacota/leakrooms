/* ============================================================
   PATHFINDING — Pure walking-distance field over floor tiles.
   No random numbers, no side effects, headless-safe.
   ============================================================ */

import { MAP_W, MAP_H, FLOOR } from '../config/constants.js';

/* Four-connected neighbours. The agent moveEnt uses this geometry. */
const NEIGHBOURS = [[1,0], [-1,0], [0,1], [0,-1]];

/**
 * Builds a walking-distance field from the target tile.
 * Only FLOOR tiles are traversable; everything else is -1 (unreachable).
 *
 * @param {Uint8Array} grid - the floor grid (MAP_W x MAP_H)
 * @param {number} targetX - target tile X (integer)
 * @param {number} targetY - target tile Y (integer)
 * @returns {Int16Array} distance field of size MAP_W * MAP_H.
 *   Value is the minimum number of steps to reach the target, or -1 if unreachable.
 */
export function distanceField(grid, targetX, targetY){
  const size = MAP_W * MAP_H;
  const field = new Int16Array(size);
  field.fill(-1);

  const tx = Math.floor(targetX);
  const ty = Math.floor(targetY);

  /* Target must be on floor and inside the map. */
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return field;
  if (grid[ty * MAP_W + tx] !== FLOOR) return field;

  const queue = new Uint32Array(size);
  let head = 0, tail = 0;

  const tidx = ty * MAP_W + tx;
  field[tidx] = 0;
  queue[tail++] = tidx;

  while (head < tail){
    const idx = queue[head++];
    const x = idx % MAP_W;
    const y = (idx / MAP_W) | 0;
    const d = field[idx];
    const nd = d + 1;

    for (const [dx, dy] of NEIGHBOURS){
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      const nidx = ny * MAP_W + nx;
      if (field[nidx] !== -1) continue;
      if (grid[nidx] !== FLOOR) continue;
      field[nidx] = nd;
      queue[tail++] = nidx;
    }
  }
  return field;
}

/**
 * Returns the neighbour tile with the lowest distance value.
 * Used by an agent to step toward the target along the gradient.
 *
 * @param {Int16Array} field - distance field from distanceField()
 * @param {number} x - current tile X (integer)
 * @param {number} y - current tile Y (integer)
 * @returns {{x:number, y:number}|null} neighbour with lowest value, or null if none
 */
export function nextStep(field, x, y){
  const idx = y * MAP_W + x;
  const here = field[idx];
  if (here <= 0) return null; // at target or unreachable

  let best = null, bestVal = here;
  for (const [dx, dy] of NEIGHBOURS){
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
    const val = field[ny * MAP_W + nx];
    if (val >= 0 && val < bestVal){
      bestVal = val;
      best = {x: nx, y: ny};
    }
  }
  return best;
}

/**
 * Counts how many tiles in the field were visited (value >= 0).
 * Useful for tests to assert the BFS visited at most MAP_W * MAP_H tiles.
 */
export function visitedCount(field){
  let n = 0;
  for (let i = 0; i < field.length; i++) if (field[i] >= 0) n++;
  return n;
}