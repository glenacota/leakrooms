import { BATT_MAX, RADAR_DRAIN, R, SPRINT, SPRINT_NOISE, WALK } from '../config/constants.js';
import { emit } from '../util/events.js';
import { moveEnt, unstick } from './collision.js';
import { seedSplash, wetAt } from './flood.js';
import { emitNoise, sustainedNoise } from './noise.js';
import { keys } from './keys.js';
import { G } from './state.js';

/* --- battery --- */
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

/* --- movement ---
   Returns the frame's movement facts for the stages that run after it:
   whether the player moved, bumped, is sprinting, and how wet the tile they
   ENDED the frame on is. */
export function tickMovement(dt){
  const p = G.player;
  let ix=0, iy=0;
  if (keys['a']||keys['arrowleft'])  ix--;
  if (keys['d']||keys['arrowright']) ix++;
  if (keys['w']||keys['arrowup'])    iy--;
  if (keys['s']||keys['arrowdown'])  iy++;

  /* Wading is slower than dry walking. Sampled at the position BEFORE the move,
     not after: sampling after would use last frame's tile at the boundary,
     which reads as the speed changing a step after you leave the water rather
     than as you entering it. */
  const preWet = wetAt(p.x, p.y);

  const sprinting = keys['shift'] && (ix||iy);
  const wade = preWet > 0.25 ? 0.80 : 1;       // knee-deep costs you a fifth
  const spd = (sprinting ? SPRINT : WALK) * wade;
  let moving=false, bumped=false;

  unstick(p, R);

  if (ix||iy){
    const len=Math.hypot(ix,iy); ix/=len; iy/=len;
    const before=[p.x,p.y];
    const [dx,dy]=moveEnt(p, ix*spd*dt, iy*spd*dt, R);
    moving = (dx!==0 || dy!==0);
    p.face = Math.atan2(iy,ix);
    if (!moving && (ix!==0||iy!==0)) bumped=true;   // walked into a partition
  }

  /* Wet at the position the frame ENDS on. This is the sample G.wet carries and
     the one the stages after movement should read: the tile you are standing
     in now, not the tile you left. The wading speed above deliberately still
     uses preWet — the two answers are different questions. */
  const wet = wetAt(p.x, p.y);

  /* Wet walking is also louder than dry walking. It stays under LOUD on purpose
     — wet boots must not wake anything, or following the water would be
     strictly worse than sweeping, and the trail has to be the cheap option or
     nobody follows it at all. */
  if (moving){
    const inWater = preWet > 0.25;
    /* One power, three consumers: the meter, what the agents hear, and how
       loud the footstep is. Passing it to the voice as well is what makes a
       sprinting step sound like a sprinting step instead of a louder walk. */
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
    /* Waking pushes a ripple ahead of you. It is a readable trace of where you
       have been, which is a second cue on top of the noise you already made. */
    if (preWet > 0.3){
      p.rippleT = (p.rippleT||0) - dt;
      if (p.rippleT <= 0){ p.rippleT = 0.22; seedSplash(p.x, p.y, preWet*0.55); }
    }
  }
  /* Walking into a partition is the player's doing, so it is the player's noise
     on the meter — the sharp little spike above whatever you were already
     making. */
  if (bumped && sprinting) emitNoise(0.55, p.x, p.y, true);
  else if (bumped) sustainedNoise(0.3, p.x, p.y, true);

  return { moving, bumped, sprinting, wet };
}
