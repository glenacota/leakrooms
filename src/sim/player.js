import { BATT_MAX, NOISE, RADAR_DRAIN, R, SPRINT, WALK } from '../config/constants.js';
import { emit } from '../util/events.js';
import { createCollision } from './collision.js';
import { seedSplash, wetAt } from './flood.js';
import { emitNoise, sustainedNoise } from './noise.js';
import { keys } from './keys.js';

/**
 * Player state bundle passed by reference.
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
 *   dripT?: number
 * }} PlayerState
 */

/**
 * Player mutable state for battery/radar.
 * @typedef {{
 *   batt: number,
 *   radar: boolean,
 *   radarRattleT: number
 * }} PlayerMetaState
 */

/* ---------- Battery ----------
   The radar drains the battery while it is on, and switches itself off at zero.
   Walking over a battery pickup adds 50. */
export function tickBattery(playerMeta, player, batteries, dt){
  if (playerMeta.radar){
    playerMeta.batt -= RADAR_DRAIN*dt;
    if (playerMeta.batt<=0){ playerMeta.batt=0; playerMeta.radar=false; emit('flash', 'NO POWER — THE RADAR IS DEAD'); }
    playerMeta.radarRattleT = (playerMeta.radarRattleT||0) - dt;
    if (playerMeta.radarRattleT <= 0){ emit('sfx', 'clink', 0.4); playerMeta.radarRattleT = 0.6; }
  } else {
    playerMeta.radarRattleT = 0;
  }
  for (const b of batteries){
    if (b.taken) continue;
    if (Math.hypot(b.x-player.x,b.y-player.y)<0.85){ b.taken=true; playerMeta.batt=Math.min(BATT_MAX,playerMeta.batt+50); emit('flash', '+50 BATTERY'); }
  }
}

/**
 * Moves the player from the held keys and makes the noise that goes with it.
 *
 * @param {number} dt - seconds since the last step.
 * @param {PlayerState} player
 * @param {PlayerMetaState} playerMeta
 * @param {Uint8Array} grid
 * @param {Array<{x:number,y:number,taken:boolean}>} batteries
 * @param {FloodState} floodState
 * @returns {{moving: boolean, bumped: boolean, sprinting: boolean, wet: number}}
 *   what happened this frame, for the steps that run after movement. `wet` is
 *   how wet the tile the player ENDED the frame on is.
 */
export function tickMovement(player, playerMeta, grid, batteries, floodState, dt){
  const { moveEnt, unstick } = createCollision(grid);

  let ix=0, iy=0;
  if (keys['a']||keys['arrowleft'])  ix--;
  if (keys['d']||keys['arrowright']) ix++;
  if (keys['w']||keys['arrowup'])    iy--;
  if (keys['s']||keys['arrowdown'])  iy++;

  /* Wading is slower than walking on dry floor. The wetness is read BEFORE the
     move, so the speed changes when you enter the water. (Reading it after the
     move would use the last frame's tile at a boundary, and the speed would
     change a step after you leave the water.) */
  const preWet = wetAt(floodState, player.x, player.y);

  const sprinting = keys['shift'] && (ix||iy);
  const wade = preWet > 0.25 ? 0.80 : 1;       // knee-deep water costs you a fifth of your speed
  const spd = (sprinting ? SPRINT : WALK) * wade;
  let moving=false, bumped=false;

  unstick(player, R);

  if (ix||iy){
    const len=Math.hypot(ix,iy); ix/=len; iy/=len;
    const before=[player.x,player.y];
    const [dx,dy]=moveEnt(player, ix*spd*dt, iy*spd*dt, R);
    moving = (dx!==0 || dy!==0);
    player.face = Math.atan2(iy,ix);
    if (!moving && (ix!==0||iy!==0)) bumped=true;   // walked into a wall
  }

  /* The wetness at the position the frame ENDS on. It is returned as `wet` and
     stored on playerMeta.wet (or similar), so the later stages read the tile you are standing on now and
     not the one you left. The wading speed above uses preWet on purpose: the two
     answer different questions. */
  const wet = wetAt(floodState, player.x, player.y);

  /* Wet walking is louder than dry walking, but still under LOUD. Wet boots must
     not wake anything, or following the water would be worse than sweeping with
     the radar, and the water trail must be the cheap option. */
  if (moving){
    const inWater = preWet > 0.25;
    /* One value, three uses: the noise meter, what the lifeforms hear, and how
       loud the footstep sounds. Passing it to the sound as well is what makes a
       sprinting step sound like a sprint and not just a louder walk. */
    const stepPow = sprinting ? NOISE.SPRINT : (inWater ? NOISE.WADE : NOISE.WALK);
    sustainedNoise(floodState, stepPow, player.x, player.y, true);
    player.stepT -= dt;
    if (player.stepT<=0){
      player.stepT = sprinting ? 0.26 : 0.46;
      player.stepDur = player.stepT;
      if (inWater) emit('sfx', 'splash', sprinting?1.4:0.5, preWet, stepPow);
      else       emit('sfx', 'step', sprinting?1.4:0.5, stepPow);
    }
    // Wading pushes a ripple ahead of you, a trace of where you have been on top of the noise you already made.
    if (preWet > 0.3){
      player.rippleT = (player.rippleT||0) - dt;
      if (player.rippleT <= 0){ player.rippleT = 0.22; seedSplash(floodState, player.x, player.y, preWet*0.55); }
    }
  }
  player.moving = moving;
  // Walking into a wall is the player's own noise, so it shows on the meter: a small spike above whatever you were already making.
  if (bumped && sprinting) emitNoise(floodState, NOISE.BUMP_SPRINT, player.x, player.y, true);
  else if (bumped) sustainedNoise(floodState, NOISE.BUMP_WALK, player.x, player.y, true);

  return { moving, bumped, sprinting, wet };
}