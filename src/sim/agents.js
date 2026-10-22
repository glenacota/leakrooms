/* ============================================================
   THE LIFEFORMS
   Each lifeform is a small state machine (a.state):
     DORMANT  lies still on the carpet; wakes only to a LOUD noise
     RISING   getting up after waking (about 1.4 s), then it hunts
     WALK     wanders the floor; a noise turns it to SEARCH, a loud one to HUNT
     SEARCH   walks to the place it heard something; times out to WALK
     HUNT     chases its target at HUNT_BASE plus HUNT_STEP per floor
   Noise reactions are in noise.js (alert).
   ============================================================ */

import { AGENT, CATCH_R, LEAK_LURE, MAP_W, RA } from '../config/constants.js';
import { HUNT_BASE, HUNT_STEP } from '../config/tuning.js';
import { createCollision } from './collision.js';
import { brush } from './noise.js';
import { distanceField, nextStep } from './path.js';

/**
 * Agent state bundle passed by reference.
 * @typedef {{
 *   agents: Array<{x:number,y:number,face:number,state:string,born:number,rise:number,target:{x:number,y:number},t:number,stepT:number,wakeCd:number,stepT:number}>,
 *   player: {x:number,y:number,face:number},
 *   seenBy: number,
 *   nearest: number,
 *   arng: function,
 *   floor: number,
 *   grid: Uint8Array,
 *   los: function,
 *   lightArr: Float32Array,
 *   visArr: Float32Array,
 *   leaks: Array<{x:number,y:number,sx:number,sy:number,fixed:boolean}>,
 * }} AgentState
 */

/* Updates every lifeform for one step, and works out two things for the rest
   of the frame:
      seenBy   how much anything can see the player (drives the red warning)
      nearest  the distance to the closest awake lifeform (drives the drone) */
export function tickAgents(agentState, dt){
  const p = agentState.player;
  let seenBy = 0, nearest = 99;
  for (const a of agentState.agents){
    updateAgent(agentState, a, dt, p);
    const d = Math.hypot(a.x-p.x, a.y-p.y);
    if (a.state!=='DORMANT' && a.rise>0.5) nearest = Math.min(nearest, d);
    // Line-of-sight check: close enough, facing the player, and nothing in between
    if (a.rise>0.5 && d < AGENT.SIGHT){
      const vx=Math.cos(a.face), vy=Math.sin(a.face);
      const dot = ((p.x-a.x)*vx + (p.y-a.y)*vy) / (d||1);
      if (dot > AGENT.SIGHT_DOT && agentState.los(a.x,a.y,p.x,p.y)){
        /* It sees you by the light you stand in, which is the bake times the
           room visibility. Using the bake alone would let it see you in a room
           whose lights are, as far as the screen shows, off. */
        const pi = Math.floor(p.y)*MAP_W+Math.floor(p.x);
        const amb = (agentState.lightArr[pi] || 0) * (agentState.visArr[pi] || 0);
        if (amb > AGENT.SIGHT_AMBIENT){
          seenBy = Math.max(seenBy, 1);
          if (a.born<=0){ a.state='HUNT'; a.target={x:p.x,y:p.y}; a.t=0; }
        }
      }
    }
  }
  agentState.seenBy = Math.max(0, agentState.seenBy + (seenBy?dt*6:-dt*2.5));
  agentState.nearest = nearest;
}

/**
 * Runs one lifeform's state machine for one step.
 *
 * @param {AgentState} agentState
 * @param {object} a - the lifeform.
 * @param {number} dt - seconds since the last step.
 * @param {object} p - the player.
 */
export function updateAgent(agentState, a, dt, p){
  const { moveEnt, unstick, blocked } = createCollision(agentState.grid);

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
      a.target = randomFloorNear(agentState, a.x,a.y, 14, blocked);
      a.t = 2.6 + agentState.arng()*3;
    }
    a.t -= dt;
    const spd = AGENT.WALK_SPEED + agentState.floor*AGENT.WALK_STEP;
    const ang = Math.atan2(a.target.y-a.y, a.target.x-a.x);
    a.face = ang;
    moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
    if (Math.hypot(a.x-p.x, a.y-p.y) < CATCH_R) brush(a, p, agentState);
    return;
  }

  if (a.state==='HUNT'){
    a.rise = Math.min(1, a.rise + dt*2.4);
    a.t -= dt;
    const spd = HUNT_BASE + agentState.floor*HUNT_STEP;
    const tgt = a.target || {x:p.x,y:p.y};
    const tx = Math.floor(tgt.x), ty = Math.floor(tgt.y);
    const cx = Math.floor(a.x), cy = Math.floor(a.y);

    /* Line of sight to target? If yes, move straight toward it (with wall slide).
       If no, follow the distance field gradient around walls. */
    const hasLOS = agentState.los(a.x, a.y, tgt.x, tgt.y);

    if (hasLOS){
      /* Straight line to target when visible. */
      const ang = Math.atan2(tgt.y-a.y, tgt.x-a.x);
      a.face = ang;
      const [dx,dy] = moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
      if (Math.hypot(dx,dy)<0.001){
        moveEnt(a, Math.cos(ang+1.57)*spd*dt, Math.sin(ang+1.57)*spd*dt, RA);
      }
    } else {
      /* No LOS: follow distance field gradient. Rebuild field when target tile changes
         or agent moves more than 1 tile from cached position. */
      if (!a._pathField || a._pathTx !== tx || a._pathTy !== ty || Math.abs(cx - a._pathCx) > 1 || Math.abs(cy - a._pathCy) > 1){
        a._pathField = distanceField(agentState.grid, tx, ty);
        a._pathTx = tx; a._pathTy = ty;
        a._pathCx = cx; a._pathCy = cy;
      }
      const step = a._pathField ? nextStep(a._pathField, cx, cy) : null;
      if (step){
        const ang = Math.atan2(step.y + 0.5 - a.y, step.x + 0.5 - a.x);
        a.face = ang;
        moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
      } else {
        /* Fallback: straight line if no path (should not happen on connected floors). */
        const ang = Math.atan2(tgt.y-a.y, tgt.x-a.x);
        a.face = ang;
        const [dx,dy] = moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
        if (Math.hypot(dx,dy)<0.001){
          moveEnt(a, Math.cos(ang+1.57)*spd*dt, Math.sin(ang+1.57)*spd*dt, RA);
        }
      }
    }
    if (Math.hypot(a.x-p.x,a.y-p.y) < CATCH_R) brush(a, p, agentState);
    // After about 8 seconds with nothing new to chase, give up and search nearby
    if (a.t < -8){ a.state='SEARCH'; a.t=6; a.target=randomFloorNear(agentState, a.x,a.y,9, blocked); }
    return;
  }

  if (a.state==='SEARCH'){
    a.t -= dt;

    /* THE LURE. An open pipe is a standing noise source, and a searching
       lifeform will walk to it. That is why a leak is a shield as well as a
       hazard: while a pipe is open, anything curious in the building is pulled
       toward a pipe and not toward you, so the repair is done with a hunter
       coming from a known place.

       With several pipes open, the nearest one takes the lifeform. A lifeform
       standing at a pipe you have not reached yet is a shield you do not have
       yet, and it should not cross the building to a far pipe.

       This applies to SEARCH only. A HUNT lifeform retargets only to LOUD
       sounds or the player's own noises (mine) — see noise.js alert().
       Quiet ambient sounds (pipes) do not pull a hunter off its chase; this
       preserves the sprint decision and the 8 s give-up timer. */
    for (const L of agentState.leaks){
      if (L.fixed) continue;
      const ld = Math.hypot(a.x-(L.sx+0.5), a.y-(L.sy+0.5));
      if (ld < LEAK_LURE && (!a.target || Math.hypot(a.x-a.target.x,a.y-a.target.y)<0.6)){
        a.target = {x:L.sx+0.5, y:L.sy+0.5};
        break;
      }
    }
    if (!a.target || Math.hypot(a.x-a.target.x,a.y-a.target.y)<0.5){
      a.target = randomFloorNear(agentState, a.x,a.y,7, blocked);
    }

    /* Move toward target: straight line if LOS, else follow distance field. */
    const tx = Math.floor(a.target.x), ty = Math.floor(a.target.y);
    const cx = Math.floor(a.x), cy = Math.floor(a.y);
    const hasLOS = agentState.los(a.x, a.y, a.target.x, a.target.y);
    const spd = AGENT.SEARCH_SPEED;

    if (hasLOS){
      const ang = Math.atan2(a.target.y-a.y, a.target.x-a.x);
      a.face = ang;
      moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
    } else {
      if (!a._pathField || a._pathTx !== tx || a._pathTy !== ty || Math.abs(cx - a._pathCx) > 1 || Math.abs(cy - a._pathCy) > 1){
        a._pathField = distanceField(agentState.grid, tx, ty);
        a._pathTx = tx; a._pathTy = ty;
        a._pathCx = cx; a._pathCy = cy;
      }
      const step = a._pathField ? nextStep(a._pathField, cx, cy) : null;
      if (step){
        const ang = Math.atan2(step.y + 0.5 - a.y, step.x + 0.5 - a.x);
        a.face = ang;
        moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
      } else {
        const ang = Math.atan2(a.target.y-a.y, a.target.x-a.x);
        a.face = ang;
        moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
      }
    }
    if (Math.hypot(a.x-p.x,a.y-p.y) < CATCH_R) brush(a, p, agentState);
    if (a.t<=0){
      a.state = 'WALK'; a.rise=1; a.target=null;
    }
  }
}

/* A random walkable spot near (x, y). It uses the floor's OWN generator
   (arng) and never Math.random(). A wandering lifeform keeps drawing random
   numbers long after the level is built, so using Math.random() would make two
   runs on the same seed drift apart within seconds, even with identical pipes,
   rooms and door. */
export function randomFloorNear(agentState, x,y,rad, blocked){
  for (let i=0;i<60;i++){
    const a=agentState.arng()*6.28, d=agentState.arng()*rad;
    const nx=x+Math.cos(a)*d, ny=y+Math.sin(a)*d;
    if (!blocked(nx,ny,0.4)) return {x:nx,y:ny};
  }
  return {x,y};
}