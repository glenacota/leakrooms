/* ============================================================
   THE LIFEFORMS
   Each lifeform is a small state machine (a.state):
     DORMANT  lies still on the carpet; wakes only to a LOUD noise
     RISING   getting up after waking (about 1.4 s), then it hunts
     WALK     wanders the floor; a noise turns it to SEARCH, a loud one to HUNT
     SEARCH   walks to the place it heard something; may go back to sleep
     HUNT     chases its target at HUNT_BASE plus HUNT_STEP per floor
   Noise reactions are in noise.js (alert).
   ============================================================ */

import { AGENT, CATCH_R, LEAK_LURE, MAP_W, RA } from '../config/constants.js';
import { HUNT_BASE, HUNT_STEP } from '../config/tuning.js';
import { blocked, moveEnt, unstick } from './collision.js';
import { brush } from './noise.js';
import { G } from './state.js';

/* Updates every lifeform for one step, and works out two things for the rest
   of the frame:
     G.seenBy   how much anything can see the player (drives the red warning)
     G.nearest  the distance to the closest awake lifeform (drives the drone) */
export function tickAgents(dt){
  const p = G.player;
  let seenBy = 0, nearest = 99;
  for (const a of G.agents){
    updateAgent(a, dt, p);
    const d = Math.hypot(a.x-p.x, a.y-p.y);
    if (a.state!=='DORMANT' && a.rise>0.5) nearest = Math.min(nearest, d);
    // Line-of-sight check: close enough, facing the player, and nothing in between
    if (a.rise>0.5 && d < AGENT.SIGHT){
      const vx=Math.cos(a.face), vy=Math.sin(a.face);
      const dot = ((p.x-a.x)*vx + (p.y-a.y)*vy) / (d||1);
      if (dot > AGENT.SIGHT_DOT && G.los(a.x,a.y,p.x,p.y)){
        /* It sees you by the light you stand in, which is the bake times the
           room visibility. Using the bake alone would let it see you in a room
           whose lights are, as far as the screen shows, off. */
        const pi = Math.floor(p.y)*MAP_W+Math.floor(p.x);
        const amb = (G.lightArr[pi] || 0) * (G.visArr[pi] || 0);
        if (amb > AGENT.SIGHT_AMBIENT){
          seenBy = Math.max(seenBy, 1);
          if (a.born<=0){ a.state='HUNT'; a.target={x:p.x,y:p.y}; a.t=0; }
        }
      }
    }
  }
  G.seenBy = Math.max(0, G.seenBy + (seenBy?dt*6:-dt*2.5));
  G.nearest = nearest;
}

/**
 * Runs one lifeform's state machine for one step.
 *
 * @param {object} a - the lifeform.
 * @param {number} dt - seconds since the last step.
 * @param {object} p - the player.
 */
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
    const spd = AGENT.WALK_SPEED + G.floor*AGENT.WALK_STEP;
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
      // Blocked: sidestep along the wall
      moveEnt(a, Math.cos(ang+1.57)*spd*dt, Math.sin(ang+1.57)*spd*dt, RA);
    }
    if (Math.hypot(a.x-p.x,a.y-p.y) < CATCH_R) brush(a, p);
    // After about 8 seconds with nothing new to chase, give up and search nearby
    if (a.t < -8){ a.state='SEARCH'; a.t=6; a.target=randomFloorNear(a.x,a.y,9); }
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

       This applies to SEARCH only, never to HUNT. If a hunting lifeform were also
       pulled away it would give up a chase you caused by sprinting, and that
       would remove the sprint decision the whole noise system is built around. */
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
    moveEnt(a, Math.cos(ang)*AGENT.SEARCH_SPEED*dt, Math.sin(ang)*AGENT.SEARCH_SPEED*dt, RA);
    if (Math.hypot(a.x-p.x,a.y-p.y) < CATCH_R) brush(a, p);
    if (a.t<=0){
      a.state = 'DORMANT'; a.rise=0.3; a.target=null;
      if (a.born<=0){ a.state='WALK'; }
    }
  }
}

/* A random walkable spot near (x, y). It uses the floor's OWN generator
   (G.arng) and never Math.random(). A wandering lifeform keeps drawing random
   numbers long after the level is built, so using Math.random() would make two
   runs on the same seed drift apart within seconds, even with identical pipes,
   rooms and door. */
export function randomFloorNear(x,y,rad){
  for (let i=0;i<60;i++){
    const a=G.arng()*6.28, d=G.arng()*rad;
    const nx=x+Math.cos(a)*d, ny=y+Math.sin(a)*d;
    if (!blocked(nx,ny,0.4)) return {x:nx,y:ny};
  }
  return {x,y};
}