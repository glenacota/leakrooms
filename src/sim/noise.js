import { LOUD, BRUSH_NOISE, MAP_W, MAP_H, NOISE } from '../config/constants.js';
import { G } from './state.js';
import { emit } from '../util/events.js';
import { solid } from './collision.js';

export const hearRadius = power => 4 + power*12;

/* How many walls are between a sound and an ear, up to a cap.

   This walked the line in whole diagonal steps — one tile east AND one tile
   north at once, so a sound five tiles due east was sampled at five positions
   instead of five tiles, and the only tiles it ever asked about were the ones
   lying on that diagonal. A wall standing squarely between two points was
   counted only if it happened to sit on the diagonal, which in a maze is a
   fraction of the walls you can actually see between two things.

   This is a Bresenham line: every tile the sound really crosses, in order, once
   each. The endpoints are the source and the listener, so neither is counted —
   a sound made standing in a doorway is not muffled by the doorway.

   The cap is the design, not an optimisation: past six walls the attenuation
   has long since done its work, and a seventh costs nothing. So a sound crossing
   a whole floor of masonry stops walking the line rather than checking seventy
   tiles to arrive at a number nobody can act on. */
const MAX_WALL_STEPS = 6;

function wallSteps(ax, ay, x, y){
  const sx=Math.floor(ax), sy=Math.floor(ay);
  const ex=Math.floor(x),   ey=Math.floor(y);
  let cx=sx, cy=sy, steps=0;
  const dx=Math.abs(ex-sx), dy=-Math.abs(ey-sy);
  const stepX = sx<ex ? 1 : -1, stepY = sy<ey ? 1 : -1;
  let err = dx+dy;
  /* Longer than any Bresenham line inside the map, so the bound can never be
     what ends the walk. */
  for (let guard=0; guard<MAP_W+MAP_H; guard++){
    if (cx===ex && cy===ey) break;
    const e2 = 2*err;
    if (e2 >= dy){ err += dy; cx += stepX; }
    if (e2 <= dx){ err += dx; cy += stepY; }
    if (solid(cx,cy) && ++steps >= MAX_WALL_STEPS) break;
  }
  return steps;
}

export function alert(a, x, y, power){
  const loud = (power||0) >= LOUD;

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

export function alertAgents(baseR, power, x, y){
  for (const a of G.agents){
    if (a.state==='WALK' && a.born>0) continue;
    const d = Math.hypot(a.x-x, a.y-y);
    if (d > baseR) continue;
    const eff = baseR - wallSteps(a.x, a.y, x, y)*NOISE.WALL_COST;
    if (d > eff) continue;
    alert(a, x, y, power);
  }
}

export function emitNoise(power, x, y, mine){
  G.noise = Math.max(G.noise, power);
  G.noisePeak = Math.max(G.noisePeak, power);
  if (mine) G.selfNoise = Math.max(G.selfNoise, power);
  G.stat.noises++;
  emit('stat', 'noises');
  alertAgents(hearRadius(power), power, x, y);
}

export function sustainedNoise(power, x, y, mine){
  G.noise = Math.max(G.noise, power);
  G.noisePeak = Math.max(G.noisePeak, power);
  if (mine) G.selfNoise = Math.max(G.selfNoise, power);
  alertAgents(hearRadius(power), power, x, y);
}

export function brush(a, p){
  if (a.state==='HUNT'){ emit('caught'); return; }
  a.state='HUNT'; a.target={x:p.x, y:p.y}; a.t=0;
  a.rise=Math.max(a.rise, 0.85);
  emitNoise(BRUSH_NOISE, p.x, p.y);
  emit('flash', 'IT TOUCHED YOU');
  emit('sfx', 'rattle', 1);
}
