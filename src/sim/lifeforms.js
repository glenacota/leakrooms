/* ============================================================
   THE LIFEFORMS
   Each lifeform is a small state machine (lf.state):
     DORMANT  lies still on the carpet; wakes only to a LOUD noise
     RISING   getting up after waking (about 1.4 s), then it hunts
     WALK     wanders the floor; a noise turns it to SEARCH, a loud one to HUNT
     SEARCH   walks to the place it heard something; times out to WALK
     HUNT     chases its target at HUNT_BASE plus HUNT_STEP per floor
   Noise reactions are in noise.js (alert).
   ============================================================ */

import { LIFEFORM, CATCH_R, LEAK_LURE, MAP_W } from '../config/constants.js';
import { HUNT_BASE, HUNT_STEP } from '../config/tuning.js';
import { createCollision } from './collision.js';
import { brush } from './noise.js';
import { distanceField, nextStep } from './path.js';

/**
 * Lifeform state bundle passed by reference.
 * @typedef {{
 *   lifeforms: Array<{x:number,y:number,face:number,state:string,born:number,rise:number,target:{x:number,y:number},t:number,stepT:number,wakeCd:number,stepT:number}>,
 *   plumber: {x:number,y:number,face:number},
 *   seenBy: number,
 *   nearest: number,
 *   arng: function,
 *   floor: number,
 *   grid: Uint8Array,
 *   los: function,
 *   lightArr: Float32Array,
 *   visArr: Float32Array,
 *   leaks: Array<{x:number,y:number,sx:number,sy:number,fixed:boolean}>,
 * }} LifeformState
 */

/* Updates every lifeform for one step, and works out two things for the rest
   of the frame:
      seenBy   how much anything can see the plumber (drives the red warning)
      nearest  the distance to the closest awake lifeform (drives the drone) */
export function tickLifeforms(lifeformState, dt){
  const p = lifeformState.plumber;
  let seenBy = 0, nearest = 99;
  for (const lf of lifeformState.lifeforms){
    updateLifeform(lifeformState, lf, dt, p);
    const d = Math.hypot(lf.x-p.x, lf.y-p.y);
    if (lf.state!=='DORMANT' && lf.rise>0.5) nearest = Math.min(nearest, d);
    // Line-of-sight check: close enough, facing the plumber, and nothing in between
    if (lf.rise>0.5 && d < LIFEFORM.SIGHT){
      const vx=Math.cos(lf.face), vy=Math.sin(lf.face);
      const dot = ((p.x-lf.x)*vx + (p.y-lf.y)*vy) / (d||1);
      if (dot > LIFEFORM.SIGHT_DOT && lifeformState.los(lf.x,lf.y,p.x,p.y)){
        /* It sees you by the light you stand in, which is the bake times the
           room visibility. Using the bake alone would let it see you in a room
           whose lights are, as far as the screen shows, off. */
        const pi = Math.floor(p.y)*MAP_W+Math.floor(p.x);
        const amb = (lifeformState.lightArr[pi] || 0) * (lifeformState.visArr[pi] || 0);
        if (amb > LIFEFORM.SIGHT_AMBIENT){
          seenBy = Math.max(seenBy, 1);
          if (lf.born<=0){ lf.state='HUNT'; lf.target={x:p.x,y:p.y}; lf.t=0; }
        }
      }
    }
  }
  lifeformState.seenBy = Math.max(0, lifeformState.seenBy + (seenBy?dt*6:-dt*2.5));
  lifeformState.nearest = nearest;
}

/**
 * Runs one lifeform's state machine for one step.
 *
 * @param {LifeformState} lifeformState
 * @param {object} lf - the lifeform.
 * @param {number} dt - seconds since the last step.
 * @param {object} p - the plumber.
 */
export function updateLifeform(lifeformState, lf, dt, p){
  const { moveEnt, unstick, blocked } = createCollision(lifeformState.grid);

  lf.born = Math.max(0, lf.born-dt);
  unstick(lf, LIFEFORM.RADIUS);

  if (lf.state==='DORMANT'){ lf.rise += (0-lf.rise)*Math.min(1,dt*3); return; }

  if (lf.state==='RISING'){
    lf.rise = Math.min(1, lf.rise + dt/1.4);
    lf.wakeCd = Math.max(0, lf.wakeCd-dt);
    if (lf.rise>=1){ lf.state='HUNT'; lf.t=0; }
    return;
  }

  if (lf.state==='WALK'){
    lf.rise = Math.min(1, lf.rise + dt/1.0);
    if (!lf.target || Math.hypot(lf.x-lf.target.x, lf.y-lf.target.y)<0.5 || lf.t<=0){
      lf.target = randomFloorNear(lifeformState, lf.x,lf.y, 14, blocked);
      lf.t = 2.6 + lifeformState.arng()*3;
    }
    lf.t -= dt;
    const spd = LIFEFORM.WALK_SPEED + lifeformState.floor*LIFEFORM.WALK_STEP;
    const ang = Math.atan2(lf.target.y-lf.y, lf.target.x-lf.x);
    lf.face = ang;
    moveEnt(lf, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, LIFEFORM.RADIUS);
    if (Math.hypot(lf.x-p.x, lf.y-p.y) < CATCH_R) brush(lf, p, lifeformState);
    return;
  }

  if (lf.state==='HUNT'){
    lf.rise = Math.min(1, lf.rise + dt*2.4);
    const spd = HUNT_BASE + lifeformState.floor*HUNT_STEP;
    const tgt = lf.target || {x:p.x,y:p.y};
    const tx = Math.floor(tgt.x), ty = Math.floor(tgt.y);
    const cx = Math.floor(lf.x), cy = Math.floor(lf.y);
    const distToTarget = Math.hypot(lf.x - tgt.x, lf.y - tgt.y);

    /* Hold-and-turn phase: when we reach the target (within 0.5 tiles), pause for 2s
       and slowly turn in place before the 8s give-up timer starts. */
    const atTarget = distToTarget < 0.5;
    if (atTarget && !lf.hold && !lf.holdDone){
      lf.hold = 2.0; // 2 seconds of holding and turning
    }
    if (lf.hold){
      lf.hold -= dt;
      /* Turn slowly in place (face rotates). */
      lf.face += dt * 3.0; // ~172 deg/s, full circle in ~2s
      if (lf.hold <= 0){
        lf.hold = 0;
        lf.holdDone = true;
        lf.t = 0; // Start the 8s give-up timer now
      }
    } else {
      lf.t -= dt;
      /* Line of sight to target? If yes, move straight toward it (with wall slide).
         If no, follow the distance field gradient around walls. */
      const hasLOS = lifeformState.los(lf.x, lf.y, tgt.x, tgt.y);

      if (hasLOS){
        /* Straight line to target when visible. */
        const ang = Math.atan2(tgt.y-lf.y, tgt.x-lf.x);
        lf.face = ang;
        const [dx,dy] = moveEnt(lf, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, LIFEFORM.RADIUS);
        if (Math.hypot(dx,dy)<0.001){
          moveEnt(lf, Math.cos(ang+1.57)*spd*dt, Math.sin(ang+1.57)*spd*dt, LIFEFORM.RADIUS);
        }
      } else {
        /* No LOS: follow distance field gradient. Rebuild field when target tile changes
           or agent moves more than 1 tile from cached position. */
        if (!lf._pathField || lf._pathTx !== tx || lf._pathTy !== ty || Math.abs(cx - lf._pathCx) > 1 || Math.abs(cy - lf._pathCy) > 1){
          lf._pathField = distanceField(lifeformState.grid, tx, ty);
          lf._pathTx = tx; lf._pathTy = ty;
          lf._pathCx = cx; lf._pathCy = cy;
        }
        const step = lf._pathField ? nextStep(lf._pathField, cx, cy) : null;
        if (step){
          const ang = Math.atan2(step.y + 0.5 - lf.y, step.x + 0.5 - lf.x);
          lf.face = ang;
          moveEnt(lf, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, LIFEFORM.RADIUS);
        } else {
          /* Fallback: straight line if no path (should not happen on connected floors). */
          const ang = Math.atan2(tgt.y-lf.y, tgt.x-lf.x);
          lf.face = ang;
          const [dx,dy] = moveEnt(lf, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, LIFEFORM.RADIUS);
          if (Math.hypot(dx,dy)<0.001){
            moveEnt(lf, Math.cos(ang+1.57)*spd*dt, Math.sin(ang+1.57)*spd*dt, LIFEFORM.RADIUS);
          }
        }
      }
    }
    if (Math.hypot(lf.x-p.x,lf.y-p.y) < CATCH_R) brush(lf, p, lifeformState);
    // After about 8 seconds with nothing new to chase, give up and search nearby
    if (lf.t < -8){ lf.state='SEARCH'; lf.t=6; lf.target=randomFloorNear(lifeformState, lf.x,lf.y,9, blocked); lf.hold=0; lf.holdDone=0; }
    return;
  }

  if (lf.state==='SEARCH'){
    lf.t -= dt;

    /* THE LURE. An open pipe is a standing noise source, and a searching
       lifeform will walk to it. That is why a leak is a shield as well as a
       hazard: while a pipe is open, anything curious in the building is pulled
       toward a pipe and not toward you, so the repair is done with a hunter
       coming from a known place.

       With several pipes open, the nearest one takes the lifeform. A lifeform
       standing at a pipe you have not reached yet is a shield you do not have
       yet, and it should not cross the building to a far pipe.

       This applies to SEARCH only. A HUNT lifeform retargets only to LOUD
       sounds or the plumber's own noises (mine) — see noise.js alert().
       Quiet ambient sounds (pipes) do not pull a hunter off its chase; this
       preserves the sprint decision and the 8 s give-up timer. */
    for (const L of lifeformState.leaks){
      if (L.fixed) continue;
      const ld = Math.hypot(lf.x-(L.sx+0.5), lf.y-(L.sy+0.5));
      if (ld < LEAK_LURE && (!lf.target || Math.hypot(lf.x-lf.target.x,lf.y-lf.target.y)<0.6)){
        lf.target = {x:L.sx+0.5, y:L.sy+0.5};
        break;
      }
    }
    if (!lf.target || Math.hypot(lf.x-lf.target.x,lf.y-lf.target.y)<0.5){
      lf.target = randomFloorNear(lifeformState, lf.x,lf.y,7, blocked);
    }

    /* Move toward target: straight line if LOS, else follow distance field. */
    const tx = Math.floor(lf.target.x), ty = Math.floor(lf.target.y);
    const cx = Math.floor(lf.x), cy = Math.floor(lf.y);
    const hasLOS = lifeformState.los(lf.x, lf.y, lf.target.x, lf.target.y);
    const spd = LIFEFORM.SEARCH_SPEED;

    if (hasLOS){
      const ang = Math.atan2(lf.target.y-lf.y, lf.target.x-lf.x);
      lf.face = ang;
      moveEnt(lf, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, LIFEFORM.RADIUS);
    } else {
      if (!lf._pathField || lf._pathTx !== tx || lf._pathTy !== ty || Math.abs(cx - lf._pathCx) > 1 || Math.abs(cy - lf._pathCy) > 1){
        lf._pathField = distanceField(lifeformState.grid, tx, ty);
        lf._pathTx = tx; lf._pathTy = ty;
        lf._pathCx = cx; lf._pathCy = cy;
      }
      const step = lf._pathField ? nextStep(lf._pathField, cx, cy) : null;
      if (step){
        const ang = Math.atan2(step.y + 0.5 - lf.y, step.x + 0.5 - lf.x);
        lf.face = ang;
        moveEnt(lf, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, LIFEFORM.RADIUS);
      } else {
        const ang = Math.atan2(lf.target.y-lf.y, lf.target.x-lf.x);
        lf.face = ang;
        moveEnt(lf, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, LIFEFORM.RADIUS);
      }
    }
    if (Math.hypot(lf.x-p.x,lf.y-p.y) < CATCH_R) brush(lf, p, lifeformState);
    if (lf.t<=0){
      lf.state = 'WALK'; lf.rise=1; lf.target=null;
    }
  }
}

/* A random walkable spot near (x, y). It uses the floor's OWN generator
   (arng) and never Math.random(). A wandering lifeform keeps drawing random
   numbers long after the level is built, so using Math.random() would make two
   runs on the same seed drift apart within seconds, even with identical pipes,
   rooms and door. */
export function randomFloorNear(lifeformState, x,y,rad, blocked){
  for (let i=0;i<60;i++){
    const a=lifeformState.arng()*6.28, d=lifeformState.arng()*rad;
    const nx=x+Math.cos(a)*d, ny=y+Math.sin(a)*d;
    if (!blocked(nx,ny,0.4)) return {x:nx,y:ny};
  }
  return {x,y};
}