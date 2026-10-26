/* ============================================================
   PATHFINDING — Pure walking-distance field over floor tiles.
   No random numbers, no side effects, headless-safe.
   ============================================================ */

import { MAP_W, MAP_H, FLOOR } from '../config/constants.js';

/* Four-connected neighbours. The agent moveEnt uses this geometry. */
const NEIGHBOURS = [[1,0], [-1,0], [0,1], [0,-1]];

/**
 * Builds a walking-distance field over floor tiles.
 * Numeric target coordinates preserve the single-source API. An array of
 * source tile indices or {x,y} tiles returns both distances and BFS visit order.
 *
 * @param {Uint8Array} grid
 * @param {number|Array<number|{x:number,y:number}>} targetX - target X or sources
 * @param {number} [targetY]
 * @returns {Int16Array|{dist:Int32Array,order:number[]}}
 */
export function distanceField(grid, targetX, targetY){
  const size = MAP_W * MAP_H;
  const multi = Array.isArray(targetX) ||
    (ArrayBuffer.isView(targetX) && typeof targetX[Symbol.iterator] === 'function');
  const dist = multi ? new Int32Array(size) : new Int16Array(size);
  dist.fill(-1);
  const order = [];
  const queue = new Uint32Array(size);
  let head = 0, tail = 0;

  const sources = multi ? targetX : [{
    x: Math.floor(targetX), y: Math.floor(targetY)
  }];
  for (const source of sources){
    const idx = multi
      ? (typeof source === 'number' ? source : Math.floor(source.y)*MAP_W+Math.floor(source.x))
      : source.y*MAP_W+source.x;
    if (!Number.isInteger(idx) || idx<0 || idx>=size || grid[idx]!==FLOOR || dist[idx]===0) continue;
    dist[idx]=0;
    queue[tail++]=idx;
    order.push(idx);
  }

  while (head<tail){
    const idx=queue[head++], x=idx%MAP_W, y=(idx/MAP_W)|0, nd=dist[idx]+1;
    for (const [dx,dy] of NEIGHBOURS){
      const nx=x+dx, ny=y+dy;
      if (nx<0 || nx>=MAP_W || ny<0 || ny>=MAP_H) continue;
      const nidx=ny*MAP_W+nx;
      if (dist[nidx]!==-1 || grid[nidx]!==FLOOR) continue;
      dist[nidx]=nd;
      queue[tail++]=nidx;
      order.push(nidx);
    }
  }
  return multi ? {dist, order} : dist;
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