/* ============================================================
   NOISE
   Lifeforms hunt by sound. A noise has a power, and how far it carries is set
   by hearRadius. Walls shorten that distance (NOISE.WALL_COST each), so
   masonry is cover. Quiet sounds only make a lifeform curious (power below
   LOUD). Loud sounds wake sleepers and start hunts.
   ============================================================ */

import { MAP_W, MAP_H, NOISE } from '../config/constants.js';
import { emit } from '../util/events.js';
import { createCollision } from './collision.js';

/**
 * Noise state bundle passed by reference.
 * @typedef {{
 *   noise: number,
 *   noisePeak: number,
 *   selfNoise: number,
 *   ambientNoise: number,
 *   stat: {noises:number, deaths:number, sealed:number},
 *   agents: Array<{x:number,y:number,state:string,born:number}>,
 *   leaks: Array<{x:number,y:number,sx:number,sy:number,fixed:boolean}>,
 *   leaksOpen: number,
 *   grid: Uint8Array,
 *   floodCover: number,
 *   leakTotal: number,
 *   leakDist: number,
 *   leakPower: number,
 *   atLeak: boolean
 * }} NoiseState
 */

// How far a sound of this power carries through open floor, in tiles.
export const hearRadius = power => NOISE.HEAR_BASE + power*NOISE.HEAR_GAIN;

/* The walk along a sound's path counts walls and stops after this many.
   Beyond six walls the sound is long gone, so counting a seventh changes
   nothing and the loop can stop early. */
const MAX_WALL_STEPS = 6;

/* Counts the wall tiles between two points, up to the cap.
   It walks a straight line (Bresenham) through every tile the line actually
   crosses. The start and end tiles are not counted, so a sound made in a
   doorway is not muffled by the doorway.

   To make the count symmetric (wallSteps(a,b) === wallSteps(b,a)), the line
   is always walked from the canonical end: the tile with the smaller linear
   index (y*MAP_W + x). This ensures the same tiles are visited in the same
   order regardless of argument order. */
export function wallSteps(grid, ax, ay, x, y){
  const { solid } = createCollision(grid);
  const sx=Math.floor(ax), sy=Math.floor(ay);
  const ex=Math.floor(x),   ey=Math.floor(y);

  // Canonical order: walk from the tile with the smaller linear index.
  // This makes wallSteps(a,b) === wallSteps(b,a) because Bresenham is
  // deterministic for a given start/end, and we fix the direction.
  const sIdx = sy*MAP_W + sx;
  const eIdx = ey*MAP_W + ex;
  const startX = sIdx <= eIdx ? sx : ex;
  const startY = sIdx <= eIdx ? sy : ey;
  const endX   = sIdx <= eIdx ? ex : sx;
  const endY   = sIdx <= eIdx ? ey : sy;

  let cx=startX, cy=startY, steps=0;
  const dx=Math.abs(endX-startX), dy=-Math.abs(endY-startY);
  const stepX = startX<endX ? 1 : -1, stepY = startY<endY ? 1 : -1;
  let err = dx+dy;
  // The guard is longer than any line inside the map, so it only stops a bug from looping forever.
  for (let guard=0; guard<MAP_W+MAP_H; guard++){
    if (cx===endX && cy===endY) break;
    const e2 = 2*err;
    if (e2 >= dy){ err += dy; cx += stepX; }
    if (e2 <= dx){ err += dx; cy += stepY; }
    if (solid(cx,cy) && ++steps >= MAX_WALL_STEPS) break;
  }
  return steps;
}

/* Reacts to a sound that reached a lifeform:
     dormant   wakes up only if the sound is LOUD
     walking   turns to investigate (SEARCH), or hunts if the sound is LOUD
     hunting   keeps hunting, now toward the new sound
   Lifeforms still in their opening grace period (born > 0) ignore everything
   except waking from dormancy.
   A lifeform that is RISING ignores all further sound until it is up. */
export function alert(a, x, y, power){
  if (a.state==='RISING') return;

  const loud = (power||0) >= NOISE.LOUD;

  if (a.state==='DORMANT'){
    if (!loud) return;
    a.state='RISING'; a.rise=0; a.target={x,y};
    a.stepT = 0;
    emit('sfx', 'rattle', a.born>0 ? 1 : 0.55);
    return;
  }
  if (a.born>0) return;

  if (loud || a.state==='HUNT'){ a.state='HUNT'; a.target={x,y}; a.t=0; }
  else if (a.state==='WALK'){ a.state='SEARCH'; a.t=4.5; a.target={x,y}; }
}

// Tells every lifeform that can hear the sound. baseR is the open-floor range, and walls shorten it per lifeform.
export function alertAgents(noiseState, baseR, power, x, y){
  for (const a of noiseState.agents){
    if (a.state==='WALK' && a.born>0) continue;
    const d = Math.hypot(a.x-x, a.y-y);
    if (d > baseR) continue;
    const eff = baseR - wallSteps(noiseState.grid, a.x, a.y, x, y)*NOISE.WALL_COST;
    if (d > eff) continue;
    alert(a, x, y, power);
  }
}

/**
 * A one-off noise, such as a bump or a touch. Counts toward the noise stats.
 *
 * @param {NoiseState} noiseState
 * @param {number} power - loudness (see LOUD and the noise constants).
 * @param {number} x - where the sound is made, in tiles.
 * @param {number} y
 * @param {boolean} [mine] - true if the player made it, so it shows on the player's own noise bar.
 */
export function emitNoise(noiseState, power, x, y, mine){
  noiseState.noise = Math.max(noiseState.noise, power);
  noiseState.noisePeak = Math.max(noiseState.noisePeak, power);
  if (mine) noiseState.selfNoise = Math.max(noiseState.selfNoise, power);
  else noiseState.ambientNoise = Math.max(noiseState.ambientNoise, power);
  noiseState.stat.noises++;
  emit('stat', 'noises');
  alertAgents(noiseState, hearRadius(power), power, x, y);
}

/* A noise that continues, such as walking or an open pipe. It is called every
   frame, so it does not count toward the stats (that would inflate them) and
   it relies on the meter's own decay. */
export function sustainedNoise(noiseState, power, x, y, mine){
  noiseState.noise = Math.max(noiseState.noise, power);
  noiseState.noisePeak = Math.max(noiseState.noisePeak, power);
  if (mine) noiseState.selfNoise = Math.max(noiseState.selfNoise, power);
  else noiseState.ambientNoise = Math.max(noiseState.ambientNoise, power);
  alertAgents(noiseState, hearRadius(power), power, x, y);
}

/* A hunting lifeform touching the player is fatal. A lifeform that was not
   hunting yet starts hunting and makes a loud noise instead. */
export function brush(a, p, noiseState){
  if (a.state==='HUNT'){ emit('caught'); return; }
  a.state='HUNT'; a.target={x:p.x, y:p.y}; a.t=0;
  a.rise=Math.max(a.rise, 0.85);
  emitNoise(noiseState, NOISE.BRUSH, p.x, p.y);
  emit('flash', 'IT TOUCHED YOU');
  emit('sfx', 'rattle', 1);
}