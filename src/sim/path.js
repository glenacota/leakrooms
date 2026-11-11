/* ============================================================
   PATHFINDING — Pure walking-distance field over floor tiles.
   No random numbers, no side effects, headless-safe.
   ============================================================ */

import { MAP_W, MAP_H, FLOOR } from '../config/constants.js';

/* Four-connected neighbours. The agent moveEnt uses this geometry. */
const NEIGHBOURS = [[1,0], [-1,0], [0,1], [0,-1]];

/**
 * Traverses floor tiles in neighbour order. Depth-first traversal preserves the
 * maze generator's component order; distances are shortest only in FIFO order.
 *
 * @param {Uint8Array} grid
 * @param {Iterable<number|{x:number,y:number}>} sources
 * @param {object} [options]
 * @param {(index:number, from:number)=>boolean} [options.canEnter] - restrict floor tiles.
 * @param {(index:number, distance:number)=>boolean} [options.stopAt] - stop when a tile is removed from the queue.
 * @param {(index:number, from:number)=>number} [options.cost] - 1 for a step, Infinity to block it.
 * @param {boolean} [options.depthFirst] - use a stack instead of a queue.
 * @returns {{dist:Int32Array,order:number[]}} Distances include queued tiles when stopped early.
 */
export function traverseFloor(grid, sources, {canEnter, stopAt, cost, depthFirst=false}={}){
  const size = MAP_W * MAP_H;
  const dist = new Int32Array(size);
  dist.fill(-1);
  const order = [];
  const queue = new Uint32Array(size);
  let head = 0, tail = 0;

  for (const source of sources){
    const idx = typeof source === 'number' ? source : Math.floor(source.y)*MAP_W+Math.floor(source.x);
    if (!Number.isInteger(idx) || idx<0 || idx>=size || grid[idx]!==FLOOR ||
        dist[idx]===0 || (canEnter && !canEnter(idx, -1))) continue;
    dist[idx]=0;
    queue[tail++]=idx;
  }

  while (depthFirst ? tail>0 : head<tail){
    const idx=depthFirst ? queue[--tail] : queue[head++];
    order.push(idx);
    if (stopAt && stopAt(idx, dist[idx])) break;
    const x=idx%MAP_W, y=(idx/MAP_W)|0, nd=dist[idx]+1;
    for (const [dx,dy] of NEIGHBOURS){
      const nx=x+dx, ny=y+dy;
      if (nx<0 || nx>=MAP_W || ny<0 || ny>=MAP_H) continue;
      const nidx=ny*MAP_W+nx;
      if (dist[nidx]!==-1 || grid[nidx]!==FLOOR || (canEnter && !canEnter(nidx, idx))) continue;
      if (cost){
        const step = cost(nidx, idx);
        if (step === Infinity) continue;
        if (step !== 1) throw new RangeError('Traversal cost must be 1 or Infinity');
      }
      dist[nidx]=nd;
      queue[tail++]=nidx;
    }
  }
  return {dist, order};
}

/**
 * Builds a walking-distance field over floor tiles.
 * Numeric target coordinates preserve the single-source API. An iterable of
 * sources returns distances and BFS visit order.
 *
 * @param {Uint8Array} grid
 * @param {number|Iterable<number|{x:number,y:number}>} targetX
 * @param {number|object} [targetY] - target Y or options for multi-source BFS.
 * Options may provide `canEnter`, `stopAt` and unit-step `cost` callbacks as
 * documented by traverseFloor(). A stopped field can include queued tiles.
 * @returns {Int16Array|{dist:Int32Array,order:number[]}}
 */
export function distanceField(grid, targetX, targetY){
  const multi = typeof targetX !== 'number';
  const sources = multi ? targetX : [{x: Math.floor(targetX), y: Math.floor(targetY)}];
  const result = traverseFloor(grid, sources, multi ? targetY : undefined);
  return multi ? result : Int16Array.from(result.dist);
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