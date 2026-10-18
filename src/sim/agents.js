import { CATCH_R, LEAK_LURE, MAP_W, RA } from '../config/constants.js';
/* HUNT_BASE/HUNT_STEP are TUNABLE — applyDifficulty rewrites them per preset, so
   the chase speed is a live binding and not a snapshot taken at import. */
import { HUNT_BASE, HUNT_STEP } from '../config/tuning.js';
import { blocked, moveEnt, unstick } from './collision.js';
import { brush } from './noise.js';
import { G } from './state.js';

/* --- the agent loop ---
   The agent loop plus the sight check that feeds G.seenBy and G.nearest:
   what can see you, how close the nearest pipe of it is, and whether
   anything is allowed to start hunting this frame. (This header read "the
   radar reveals", copied from the pass below it; the radar has its own.) */
export function tickAgents(dt){
  const p = G.player;
  let seenBy = 0, nearest = 99;
  for (const a of G.agents){
    updateAgent(a, dt, p);
    const d = Math.hypot(a.x-p.x, a.y-p.y);
    if (a.state!=='DORMANT' && a.rise>0.5) nearest = Math.min(nearest, d);
    // line of sight check
    if (a.rise>0.5 && d < 8){
      const vx=Math.cos(a.face), vy=Math.sin(a.face);
      const dot = ((p.x-a.x)*vx + (p.y-a.y)*vy) / (d||1);
      if (dot > 0.28 && G.los(a.x,a.y,p.x,p.y)){
        /* What it can see you by is the BAKE times the VISIBILITY, not the
           bake alone. Reading the bake would let it see you standing in a
           room whose lights are, as far as the screen is concerned, off. */
        const pi = Math.floor(p.y)*MAP_W+Math.floor(p.x);
        const amb = (G.lightArr[pi] || 0) * (G.visArr[pi] || 0);
        if (amb > 0.30){
          seenBy = Math.max(seenBy, 1);
          if (a.born<=0){ a.state='HUNT'; a.target={x:p.x,y:p.y}; a.t=0; }
        }
      }
    }
  }
  G.seenBy = Math.max(0, G.seenBy + (seenBy?dt*6:-dt*2.5));
  G.nearest = nearest;
}

export function updateAgent(a, dt, p){
  a.born = Math.max(0, a.born-dt);
  unstick(a, RA);

  if (a.state==='DORMANT'){ a.rise += (0-a.rise)*Math.min(1,dt*3); return; }

  if (a.state==='RISING'){
    a.rise = Math.min(1, a.rise + dt/1.4);
    a.wakeCd = Math.max(0, a.wakeCd-dt);
    if (a.rise>=1){ a.state='HUNT'; a.t=0; }
    return;
  }

  if (a.state==='WALK'){
    a.rise = Math.min(1, a.rise + dt/1.0);
    if (!a.target || Math.hypot(a.x-a.target.x, a.y-a.target.y)<0.5 || a.t<=0){
      a.target = randomFloorNear(a.x,a.y, 14);
      a.t = 2.6 + G.arng()*3;
    }
    a.t -= dt;
    const spd = 1.5 + G.floor*0.1;
    const ang = Math.atan2(a.target.y-a.y, a.target.x-a.x);
    a.face = ang;
    moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
    return;
  }

  if (a.state==='HUNT'){
    a.rise = Math.min(1, a.rise + dt*2.4);
    a.t -= dt;
    const spd = HUNT_BASE + G.floor*HUNT_STEP;
    const tgt = a.target || {x:p.x,y:p.y};
    const ang = Math.atan2(tgt.y-a.y, tgt.x-a.x);
    a.face = ang;
    const [dx,dy] = moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
    if (Math.hypot(dx,dy)<0.001){
      // blocked — sidestep along the wall
      moveEnt(a, Math.cos(ang+1.57)*spd*dt, Math.sin(ang+1.57)*spd*dt, RA);
    }
    if (Math.hypot(a.x-p.x,a.y-p.y) < CATCH_R) brush(a, p);
    if (a.t < -8){ a.state='SEARCH'; a.t=6; a.target=randomFloorNear(a.x,a.y,9); }
    return;
  }

  if (a.state==='SEARCH'){
    a.t -= dt;

    /* THE LURE. An open pipe is a standing noise source, and something already
       searching will go and stand next to it. This is what makes the leak a
       shield as well as a hazard: while one is open, anything curious in the
       building is being pulled to a pipe rather than to you, so the five seconds
       at the pipe are not spent with a hunter closing from wherever it
       happened to be — they are spent with one closing from a known place.

       With four of them the NEAREST open one takes it, which is the correct
       reading: a thing standing at a pipe you have not reached yet is a shield
       you have not got yet, and it should not walk across the building to a pipe
       four rooms away just to be somewhere else.

       It only applies to SEARCH, never to HUNT. If a hunting Lifeform were
       also diverted it would abandon a chase you caused by sprinting, which
       would delete the sprint decision the entire noise layer exists for. */
    for (const L of G.leaks){
      if (L.fixed) continue;
      const ld = Math.hypot(a.x-(L.sx+0.5), a.y-(L.sy+0.5));
      if (ld < LEAK_LURE && (!a.target || Math.hypot(a.x-a.target.x,a.y-a.target.y)<0.6)){
        a.target = {x:L.sx+0.5, y:L.sy+0.5};
        break;
      }
    }
    if (!a.target || Math.hypot(a.x-a.target.x,a.y-a.target.y)<0.5){
      a.target = randomFloorNear(a.x,a.y,7);
    }
    const ang = Math.atan2(a.target.y-a.y, a.target.x-a.x);
    a.face = ang;
    moveEnt(a, Math.cos(ang)*2.3*dt, Math.sin(ang)*2.3*dt, RA);
    if (Math.hypot(a.x-p.x,a.y-p.y) < CATCH_R) brush(a, p);
    if (a.t<=0){
      a.state = 'DORMANT'; a.rise=0.3; a.target=null;
      if (a.born<=0){ a.state='WALK'; }
    }
  }
}

/* Somewhere to walk to, from the floor's OWN generator — never Math.random().
   A wandering Lifeform is the one thing in the game that keeps drawing numbers
   long after the level was built, so it is the one thing that used to make two
   runs on the same seed diverge within seconds of each other: the pipes, the
   rooms and the door were all identical and the building around them was not. */
export function randomFloorNear(x,y,rad){
  for (let i=0;i<60;i++){
    const a=G.arng()*6.28, d=G.arng()*rad;
    const nx=x+Math.cos(a)*d, ny=y+Math.sin(a)*d;
    if (!blocked(nx,ny,0.4)) return {x:nx,y:ny};
  }
  return {x,y};
}
