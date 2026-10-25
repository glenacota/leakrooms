import { BATT_MAX, NOISE, RADAR_DRAIN, PLUMBER, SPRINT, WALK } from '../config/constants.js';
import { emit } from '../util/events.js';
import { createCollision } from './collision.js';
import { seedSplash, wetAt } from './flood.js';
import { emitNoise, sustainedNoise } from './noise.js';
import { keys, pad } from './keys.js';

/**
 * Plumber state bundle passed by reference.
 * @typedef {{
 *   x: number,
 *   y: number,
 *   face: number,
 *   stepT: number,
 *   stepDur: number,
 *   moving: boolean,
 *   px: number,
 *   py: number,
 *   rippleT?: number,
 *   dripT?: number,
 *   bumpedLastFrame?: boolean
 * }} PlumberState
 */

/**
 * Plumber mutable state for battery/radar.
 * @typedef {{
 *   batt: number,
 *   radar: boolean,
 *   radarRattleT: number
 * }} PlumberMetaState
 */

/* ---------- Battery ----------
   The radar drains the battery while it is on, and switches itself off at zero.
   Walking over a battery pickup adds 50. */
export function tickBattery(plumberMeta, plumber, batteries, dt){
  if (plumberMeta.radar){
    plumberMeta.batt -= RADAR_DRAIN*dt;
    if (plumberMeta.batt<=0){ plumberMeta.batt=0; plumberMeta.radar=false; emit('flash', 'NO POWER — THE RADAR IS DEAD'); }
    plumberMeta.radarRattleT = (plumberMeta.radarRattleT||0) - dt;
    if (plumberMeta.radarRattleT <= 0){ emit('sfx', 'clink', 0.4); plumberMeta.radarRattleT = 0.6; }
  } else {
    plumberMeta.radarRattleT = 0;
  }
  for (const b of batteries){
    if (b.taken) continue;
    if (Math.hypot(b.x-plumber.x,b.y-plumber.y)<0.85){ b.taken=true; plumberMeta.batt=Math.min(BATT_MAX,plumberMeta.batt+50); emit('flash', '+50 BATTERY'); }
  }
}

/**
 * Moves the plumber from the held keys and makes the noise that goes with it.
 *
 * @param {number} dt - seconds since the last step.
 * @param {PlumberState} plumber
 * @param {PlumberMetaState} plumberMeta
 * @param {Uint8Array} grid
 * @param {Array<{x:number,y:number,taken:boolean}>} batteries
 * @param {FloodState} floodState
 * @returns {{moving: boolean, bumped: boolean, sprinting: boolean, wet: number}}
 *   what happened this frame, for the steps that run after movement. `wet` is
 *   how wet the tile the plumber ENDED the frame on is.
 */
export function tickMovement(plumber, plumberMeta, grid, batteries, floodState, dt){
  const { moveEnt, unstick } = createCollision(grid);

  let ix=0, iy=0;
  if (keys['a']||keys['arrowleft'])  ix--;
  if (keys['d']||keys['arrowright']) ix++;
  if (keys['w']||keys['arrowup'])    iy--;
  if (keys['s']||keys['arrowdown'])  iy++;
  /* The stick adds to the keys. Both are clamped so keys plus stick cannot
     exceed full speed. */
  ix = Math.max(-1, Math.min(1, ix + pad.x));
  iy = Math.max(-1, Math.min(1, iy + pad.y));

  /* Wading is slower than walking on dry floor. The wetness is read BEFORE the
     move, so the speed changes when you enter the water. (Reading it after the
     move would use the last frame's tile at a boundary, and the speed would
     change a step after you leave the water.) */
  const preWet = wetAt(floodState, plumber.x, plumber.y);

  const sprinting = (keys['shift'] || pad.sprint) && (ix||iy);
  const wade = preWet > 0.25 ? 0.80 : 1;       // knee-deep water costs you a fifth of your speed
  const spd = (sprinting ? SPRINT : WALK) * wade;
  let moving=false, bumped=false;

  unstick(plumber, PLUMBER.RADIUS);

  if (ix||iy){
    const len=Math.hypot(ix,iy); ix/=len; iy/=len;
    const before=[plumber.x,plumber.y];
    const [dx,dy]=moveEnt(plumber, ix*spd*dt, iy*spd*dt, PLUMBER.RADIUS);
    moving = (dx!==0 || dy!==0);
    plumber.face = Math.atan2(iy,ix);
    if (!moving && (ix!==0||iy!==0)) bumped=true;   // walked into a wall
  }

  /* The wetness at the position the frame ENDS on. It is returned as `wet` and
     stored on plumberMeta.wet (or similar), so the later stages read the tile you are standing on now and
     not the one you left. The wading speed above uses preWet on purpose: the two
     answer different questions. */
  const wet = wetAt(floodState, plumber.x, plumber.y);

  /* Wet walking is louder than dry walking, but still under LOUD. Wet boots must
     not wake anything, or following the water would be worse than sweeping with
     the radar, and the water trail must be the cheap option. */
  if (moving){
    const inWater = preWet > 0.25;
    /* One value, three uses: the noise meter, what the lifeforms hear, and how
       loud the footstep sounds. Passing it to the sound as well is what makes a
       sprinting step sound like a sprint and not just a louder walk. */
    const stepPow = sprinting ? NOISE.SPRINT : (inWater ? NOISE.WADE : NOISE.WALK);
    sustainedNoise(floodState, stepPow, plumber.x, plumber.y, true);
    plumber.stepT -= dt;
    if (plumber.stepT<=0){
      plumber.stepT = sprinting ? 0.26 : 0.46;
      plumber.stepDur = plumber.stepT;
      if (inWater) emit('sfx', 'splash', sprinting?1.4:0.5, preWet, stepPow);
      else       emit('sfx', 'step', sprinting?1.4:0.5, stepPow);
    }
    // Wading pushes a ripple ahead of you, a trace of where you have been on top of the noise you already made.
    if (preWet > 0.3){
      plumber.rippleT = (plumber.rippleT||0) - dt;
      if (plumber.rippleT <= 0){ plumber.rippleT = 0.22; seedSplash(floodState, plumber.x, plumber.y, preWet*0.55); }
    }
  }
  plumber.moving = moving;
  // Walking into a wall is the plumber's own noise, so it shows on the meter: a small spike above whatever you were already making.
  if (bumped){
    const power = sprinting ? NOISE.BUMP_SPRINT : NOISE.BUMP_WALK;
    sustainedNoise(floodState, power, plumber.x, plumber.y, true);
    // Count the bump once per contact, not every frame.
    if (!plumber.bumpedLastFrame){
      floodState.stat.noises++;
      emit('stat', 'noises');
      plumber.bumpedLastFrame = true;
    }
  } else {
    plumber.bumpedLastFrame = false;
  }

  return { moving, bumped, sprinting, wet };
}