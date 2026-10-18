import { LOUD, BRUSH_NOISE } from '../config/constants.js';
import { G } from './state.js';
import { emit } from '../util/events.js';
import { solid } from './collision.js';

export const hearRadius = power => 4 + power*12;

function wallSteps(ax, ay, x, y){
  let steps = 0, guard=0;
  const sx=Math.floor(ax), sy=Math.floor(ay);
  const ex=Math.floor(x), ey=Math.floor(y);
  while (guard++<200){
    const px=sx+Math.sign(ex-sx)*steps, py=sy+Math.sign(ey-sy)*steps;
    if (px===ex&&py===ey) break;
    if (solid(px,py)) steps++;
    if (steps>6) break;
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
    const eff = baseR - wallSteps(a.x, a.y, x, y)*3.0;
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
