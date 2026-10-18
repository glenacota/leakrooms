import { G } from '../../sim/state.js';
import { ENT } from '../entities.js';

/* Where the fixed-step simulation has got into the step it is partway through.
   The loop owns the number and this pass only reads it, so it lives here with
   its one consumer and is written through a setter rather than assigned from
   outside. */
export let simAlpha = 0;
export function setSimAlpha(v){ simAlpha = v; }

export function actors(rc){
  const {t, p} = rc;
/* ---------- 5. entities + player, y-sorted ----------
   Drawn at the INTERPOLATED position: `lerp(prev, now, simAlpha)`, where
   simAlpha is how far the fixed-step simulation has got into the step it is
   currently partway through. The simulation is quantised to 1/60s; this is
   not. The sort key is the interpolated y, so a figure also crosses in front
   of a wall at the moment it visually does. */
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
