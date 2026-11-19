/* ============================================================
   NOISE
   Lifeforms hunt by sound. A noise has a power, and how far it carries is set
   by hearRadius. Walls shorten that distance (NOISE.WALL_COST_TILES each), so
   masonry is cover. Quiet sounds only make a lifeform curious (power below
   NOISE.LOUD). Loud sounds wake sleepers and start hunts.
   ============================================================ */

import { MAP, NOISE } from '../config/constants.js';
import { emit, EVENT } from '../util/events.js';
import { createCollision } from './collision.js';
import { walkLine } from '../util/line.js';

/**
 * Noise state bundle passed by reference.
 * @typedef {{
 *   noise: number,
 *   noisePeak: number,
 *   selfNoise: number,
 *   ambientNoise: number,
 *   stat: {noises:number, deaths:number, sealed:number},
 *   lifeforms: Array<{x:number,y:number,state:string,born:number}>,
 *   leaks: Array<{x:number,y:number,sx:number,sy:number,fixed:boolean}>,
 *   openLeaks: number,
 *   grid: Uint8Array,
 *   floodCover: number
 * }} NoiseState
 */

// How far a sound of this power carries through open floor, in tiles.
export const hearRadius = power => NOISE.HEAR_BASE_TILES + power*NOISE.HEAR_GAIN_TILES_PER_POWER;

/* The cap stops counting walls once the loudest sound has no reach left. */
export const maxNoisePower = Math.max(...NOISE.POWERS);
export const MAX_WALL_STEPS = Math.ceil(hearRadius(maxNoisePower) / NOISE.WALL_COST_TILES);

/**
 * Decays noise meters and their peak marker.
 * @param {Pick<NoiseState, 'noise'|'noisePeak'|'selfNoise'|'ambientNoise'>} state
 * @param {number} dt - seconds since the last step.
 */
export function tickNoiseDecay(state, dt){
  state.noise = Math.max(0, state.noise - dt*1.55);
  state.selfNoise = Math.max(0, state.selfNoise - dt*1.55);
  state.ambientNoise = Math.max(0, state.ambientNoise - dt*1.55);
  state.noisePeak = Math.max(state.noise, state.noisePeak - dt*0.24);
}

/* Counts the wall tiles between two points, up to the cap.
   It walks a straight line (Bresenham) through every tile the line actually
   crosses. The start and end tiles are not counted, so a sound made in a
   doorway is not muffled by the doorway.

   To make the count symmetric (wallSteps(a,b) === wallSteps(b,a)), the line
   is always walked from the canonical end: the tile with the smaller linear
   index (y*MAP.WIDTH_TILES + x). This ensures the same tiles are visited in the same
   order regardless of argument order. */
export function wallSteps(grid, ax, ay, x, y){
  const { solid } = createCollision(grid);
  const sx=Math.floor(ax), sy=Math.floor(ay);
  const ex=Math.floor(x),   ey=Math.floor(y);

  // Fix the direction so both argument orders visit the same tiles.
  const sIdx = sy*MAP.WIDTH_TILES + sx, eIdx = ey*MAP.WIDTH_TILES + ex;
  const startX = sIdx <= eIdx ? sx : ex, startY = sIdx <= eIdx ? sy : ey;
  const endX = sIdx <= eIdx ? ex : sx, endY = sIdx <= eIdx ? ey : sy;
  let first=true, steps=0;
  walkLine(startX,startY,endX,endY,(cx,cy)=>{
    if (first){ first=false; return true; }
    if (solid(cx,cy) && ++steps >= MAX_WALL_STEPS) return false;
  }, {limit:MAP.WIDTH_TILES+MAP.HEIGHT_TILES, inclusive:true});
  return steps;
}

/* Reacts to a sound that reached a lifeform:
     dormant   wakes up only if the sound is NOISE.LOUD
     walking   turns to investigate (SEARCH), or hunts if the sound is NOISE.LOUD
     hunting   retargets only if the sound is NOISE.LOUD or the player's own noise (mine).
               Quiet ambient sounds (leaks) do not pull a hunter off its chase;
               this preserves the sprint decision and the 8 s give-up timer.
    Lifeforms still in their opening grace period (born > 0) ignore everything
    except waking from dormancy.
    A lifeform that is RISING ignores all further sound until it is up. */
/**
 * @param {{state:string,x:number,y:number,born:number}} a
 * @param {{x:number,y:number,power:number,mine:boolean}} src
 * @param {{baseR:number,px:number,py:number}} ctx
 */
export function alert(a, src, ctx){
  if (a.state==='RISING') return;

  const { x, y, power, mine } = src;
  const { baseR, px, py } = ctx;
  const loud = (power||0) >= NOISE.LOUD;
  const dist = Math.hypot(a.x - x, a.y - y);

  if (a.state==='DORMANT'){
    if (!loud) return;
    a.state='RISING'; a.rise=0; a.target={x,y};
    const baseVol = a.born>0 ? 1 : 0.55;
    const dToPlayer = Math.hypot(a.x - px, a.y - py);
    const reach = baseR || hearRadius(power);
    const vol = baseVol * Math.max(0.15, 1 - dToPlayer / reach);
    emit(EVENT.sfx, 'rattle', vol);
    emit(EVENT.heard, { from: 'DORMANT', to: 'RISING', dist });
    return;
  }
  if (a.born>0) return;

  if (a.state==='HUNT'){
    if (loud || mine){ a.target={x,y}; a.t=0; a.hold=0; }
    return;
  }
  if (loud){
    const from = a.state;
    a.state='HUNT'; a.target={x,y}; a.t=0;
    if (from !== 'HUNT') emit(EVENT.heard, { from, to: 'HUNT', dist });
    return;
  }
  if (a.state==='WALK'){
    a.state='SEARCH'; a.t=4.5; a.target={x,y};
    emit(EVENT.heard, { from: 'WALK', to: 'SEARCH', dist });
  }
}

// Tells every lifeform that can hear the sound. baseR is the open-floor range, and walls shorten it per lifeform.
export function alertLifeforms(noiseState, baseR, power, x, y, mine){
  const px = noiseState.plumber.x;
  const py = noiseState.plumber.y;
  for (const lf of noiseState.lifeforms){
    if (lf.state==='WALK' && lf.born>0) continue;
    const d = Math.hypot(lf.x-x, lf.y-y);
    if (d > baseR) continue;
    const eff = baseR - wallSteps(noiseState.grid, lf.x, lf.y, x, y)*NOISE.WALL_COST_TILES;
    if (d > eff) continue;
    alert(lf, { x, y, power, mine }, { baseR, px, py });
  }
}

/**
 * A one-off noise, such as a bump or a touch. Counts toward the noise stats.
 *
 * @param {NoiseState} noiseState
 * @param {number} power - loudness (see NOISE.LOUD and the noise constants).
 * @param {number} x - where the sound is made, in tiles.
 * @param {number} y
 * @param {boolean} [mine] - true if the plumber made it, so it shows on the plumber's own noise bar.
 */
export function emitNoise(noiseState, power, x, y, mine){
  sustainedNoise(noiseState, power, x, y, mine);
  noiseState.stat.noises++;
  emit(EVENT.stat, 'noises');
}

/* A noise that continues, such as walking or an open leak. It is called every
   frame, so it does not count toward the stats (that would inflate them) and
   it relies on the meter's own decay. */
export function sustainedNoise(noiseState, power, x, y, mine){
  noiseState.noise = Math.max(noiseState.noise, power);
  noiseState.noisePeak = Math.max(noiseState.noisePeak, power);
  if (mine) noiseState.selfNoise = Math.max(noiseState.selfNoise, power);
  else noiseState.ambientNoise = Math.max(noiseState.ambientNoise, power);
  alertLifeforms(noiseState, hearRadius(power), power, x, y, mine);
}

/* A hunting lifeform touching the plumber is fatal. A lifeform that was not
   hunting yet starts hunting and makes a loud noise instead. */
export function brush(lf, p, noiseState){
  if (lf.state==='HUNT'){ emit(EVENT.caught); return; }
  lf.state='HUNT'; lf.target={x:p.x, y:p.y}; lf.t=0;
  lf.rise=Math.max(lf.rise, 0.85);
  emitNoise(noiseState, NOISE.BRUSH, p.x, p.y);
  emit(EVENT.flash, { cat: 'danger', text: 'IT TOUCHED YOU' });
  emit(EVENT.sfx, 'rattle', 1);
}