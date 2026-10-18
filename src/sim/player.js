import { BATT_MAX, RADAR_DRAIN, R, SPRINT, SPRINT_NOISE, WALK } from '../config/constants.js';
import { emit } from '../util/events.js';
import { moveEnt, unstick } from './collision.js';
import { seedSplash, wetAt } from './flood.js';
import { emitNoise, sustainedNoise } from './noise.js';
import { keys } from './keys.js';
import { G } from './state.js';

/* ---------- Battery ----------
   The radar drains the battery while it is on, and switches itself off at zero.
   Walking over a battery pickup adds 50. */
export function tickBattery(dt){
  const p = G.player;
  if (G.radar){
    G.batt -= RADAR_DRAIN*dt;
    if (G.batt<=0){ G.batt=0; G.radar=false; emit('flash', 'NO POWER — THE RADAR IS DEAD'); }
  }
  for (const b of G.batteries){
    if (b.taken) continue;
    if (Math.hypot(b.x-p.x,b.y-p.y)<0.85){ b.taken=true; G.batt=Math.min(BATT_MAX,G.batt+50); emit('flash', '+50 BATTERY'); }
  }
}

/**
 * Moves the player from the held keys and makes the noise that goes with it.
 *
 * @param {number} dt - seconds since the last step.
 * @returns {{moving: boolean, bumped: boolean, sprinting: boolean, wet: number}}
 *   what happened this frame, for the steps that run after movement. `wet` is
 *   how wet the tile the player ENDED the frame on is.
 */
export function tickMovement(dt){
  const p = G.player;
  let ix=0, iy=0;
  if (keys['a']||keys['arrowleft'])  ix--;
  if (keys['d']||keys['arrowright']) ix++;
  if (keys['w']||keys['arrowup'])    iy--;
  if (keys['s']||keys['arrowdown'])  iy++;

  /* Wading is slower than walking on dry floor. The wetness is read BEFORE the
     move, so the speed changes when you enter the water. (Reading it after the
     move would use the last frame's tile at a boundary, and the speed would
     change a step after you leave the water.) */
  const preWet = wetAt(p.x, p.y);

  const sprinting = keys['shift'] && (ix||iy);
  const wade = preWet > 0.25 ? 0.80 : 1;       // knee-deep water costs you a fifth of your speed
  const spd = (sprinting ? SPRINT : WALK) * wade;
  let moving=false, bumped=false;

  unstick(p, R);

  if (ix||iy){
    const len=Math.hypot(ix,iy); ix/=len; iy/=len;
    const before=[p.x,p.y];
    const [dx,dy]=moveEnt(p, ix*spd*dt, iy*spd*dt, R);
    moving = (dx!==0 || dy!==0);
    p.face = Math.atan2(iy,ix);
    if (!moving && (ix!==0||iy!==0)) bumped=true;   // walked into a wall
  }

  /* The wetness at the position the frame ENDS on. It is returned as `wet` and
     stored on G.wet, so the later stages read the tile you are standing on now and
     not the one you left. The wading speed above uses preWet on purpose: the two
     answer different questions. */
  const wet = wetAt(p.x, p.y);

  /* Wet walking is louder than dry walking, but still under LOUD. Wet boots must
     not wake anything, or following the water would be worse than sweeping with
     the radar, and the water trail must be the cheap option. */
  if (moving){
    const inWater = preWet > 0.25;
    /* One value, three uses: the noise meter, what the lifeforms hear, and how
       loud the footstep sounds. Passing it to the sound as well is what makes a
       sprinting step sound like a sprint and not just a louder walk. */
    const stepPow = sprinting ? SPRINT_NOISE : (inWater ? 0.30 : 0.22);
    sustainedNoise(stepPow, p.x, p.y, true);
    p.stepT -= dt;
    if (p.stepT<=0){
      p.stepT = sprinting ? 0.26 : 0.46;
      p.stepDur = p.stepT;
      if (inWater) emit('sfx', 'splash', sprinting?1:0.5, preWet, stepPow);
      else       emit('sfx', 'step', sprinting?1:0.5, stepPow);
    }
    p.moving = moving;
    // Wading pushes a ripple ahead of you, a trace of where you have been on top of the noise you already made.
    if (preWet > 0.3){
      p.rippleT = (p.rippleT||0) - dt;
      if (p.rippleT <= 0){ p.rippleT = 0.22; seedSplash(p.x, p.y, preWet*0.55); }
    }
  }
  // Walking into a wall is the player's own noise, so it shows on the meter: a small spike above whatever you were already making.
  if (bumped && sprinting) emitNoise(0.55, p.x, p.y, true);
  else if (bumped) sustainedNoise(0.3, p.x, p.y, true);

  return { moving, bumped, sprinting, wet };
}