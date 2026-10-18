import { G } from '../../sim/state.js';
import { ENT } from '../entities.js';

/* How far the fixed-step simulation has got into the step it is partway
   through, from 0 to 1. The loop writes it through the setter and this pass only
   reads it, so it lives here beside its one reader. */
export let simAlpha = 0;
export function setSimAlpha(v){ simAlpha = v; }

export function actors(rc){
  const {t, p} = rc;
/* ---------- 5. The player and lifeforms, sorted by y ----------
   Each figure is drawn at its SMOOTHED position: lerp(previous step, current
   step, simAlpha). The simulation moves in steps of 1/60 s and the drawing does
   not, so this is what makes movement continuous. The sort key is the smoothed y
   as well, so a figure passes in front of a wall at the moment it visually does.
   Figures lower on the screen are drawn later, so they appear in front. */
const al = simAlpha;
const ix = (e)=> e.px===undefined ? e.x : e.px + (e.x-e.px)*al;
const iy = (e)=> e.py===undefined ? e.y : e.py + (e.y-e.py)*al;
const draws = [];
for (const a of G.agents) draws.push({y:iy(a), kind:'a', o:a});
draws.push({y:iy(p), kind:'p', o:p});
draws.sort((m,n)=> m.y-n.y);
for (const d of draws){
  if (d.kind==='a') ENT.agent(d.o, t, ix(d.o), iy(d.o));
  else           ENT.player(p, t, ix(p), iy(p));
}
}