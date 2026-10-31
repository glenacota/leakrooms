import { LEAK_NOISE_BASE, LEAK_NOISE_GAIN, LOUD, REPAIR_DECAY, REPAIR_NOISE, REPAIR_REACH } from '../config/constants.js';
import { REPAIR_TIME } from '../config/tuning.js';
import { emit } from '../util/events.js';
import { sustainedNoise } from './noise.js';
import { pulseDue } from './pulse-timing.js';
import { repaintDirty } from '../util/repaint.js';

/**
 * Leak state bundle passed by reference.
 * @typedef {{
 *   leaks: Array<{x:number,y:number,sx:number,sy:number,fixed:boolean,repair:number,fixedAt:number,wrenchT:number}>,
 *   openLeaks: number,
 *   plumber: {x:number,y:number},
 *   time: number,
 *   floodCover: number,
 *   leakPower: number,
 *   leakTotal: number,
 *   leakDist: number,
 *   stat: {noises:number, deaths:number, sealed:number},
 *   noiseState: {noise:number, noisePeak:number, selfNoise:number, ambientNoise:number, stat:{noises:number, deaths:number, sealed:number}, lifeforms:Array, leaks:Array, openLeaks:number, grid:Uint8Array, floodCover:number, leakTotal:number, leakDist:number, leakPower:number, atLeak:boolean}
 * }} LeakState
 */

/* Returns the open leaks the player is close enough to work on, or null.
   Distance is measured to the standing spot, since the interaction is "put
   your hands on the pipe". */
export function leakAt(leaks, x, y){
  for (const L of leaks){
    if (L.fixed) continue;
    if (Math.hypot(L.sx+0.5-x, L.sy+0.5-y) < REPAIR_REACH) return L;
  }
  return null;
}
export function leakReach(leaks, x, y){
  return !!leakAt(leaks, x, y);
}

/**
 * Seals one leak permanently. It checks the fixed flag first, so it can never
 * be applied twice.
 *
 * Sealing one leak does not stop the flood: the water only starts to recede when
 * the LAST leak is sealed. So sealing one leak out of four is progress, not
 * relief.
 *
 * @param {object} L - an entry of leaks array.
 * @param {LeakState} leakState
 */
export function sealLeak(L, leakState){
  if (!L || L.fixed) return;
  L.fixed = true;
  L.fixedAt = leakState.time;
  // Clear the progress bar, so a number that means "work in progress" does not sit at 100% forever.
  L.repair = 0;
  leakState.openLeaks = Math.max(0, leakState.openLeaks-1);
  emit('sfx', 'seal');
  emit('flash', leakState.openLeaks
    ? `LEAK SEALED \u2014 ${leakState.openLeaks} STILL OPEN`
    : 'EVERY LEAK SEALED \u2014 GET BACK TO THE DOOR');
  leakState.stat.sealed++;
  emit('stat', 'sealed');
  /* The recession uses the existing distance field. Building a new field from
     the seal point would reset the water front and snap the level from flooded
     to dry in a single frame. The existing field already describes the right
     answer: water recedes from where it spread. */
  repaintDirty.water = true;
}

/* ---------- Noise from open leaks ----------
   Every open leak is a continuous noise source at its standing spot. This uses
   sustainedNoise and not repeated one-off noises, because a standing sound is
   what a lifeform can walk toward. */
export function tickLeakNoise(leakState, dt){
  const p = leakState.plumber;
  /* leakTotal is the building's standing noise: the sum of what the open
     leaks make right now. The HUD draws it as the blue part of the noise bar and
     the audio plays it, so the number the lifeform hears is the number the
     player can see. */
  leakState.leakTotal = 0;
  leakState.leakDist  = 99;
  if (leakState.openLeaks > 0){
    /* Each leak's loudness is independent of how many are open. The per-leak
       power rises with floodCover up to just below LOUD, so a leak is never a
       hunt trigger on its own. The total shown on the HUD (leakTotal) is the
       sum, clamped to just below LOUD so the blue bar never passes the LOUD
       hairline. */
    const perLeak = Math.min(LEAK_NOISE_BASE + LEAK_NOISE_GAIN*leakState.floodCover,
                             LOUD - 0.02);
    leakState.leakPower = perLeak;
    leakState.leakTotal = Math.min(perLeak * leakState.openLeaks, LOUD - 0.02);
    for (const L of leakState.leaks){
      if (L.fixed) continue;
      /* The noise comes from the standing spot (floor), not the wall the leak is
         broken in. alert() gives this coordinate to a lifeform as its target, and
         a target inside a wall would leave it standing and bumping against
         brick. */
      sustainedNoise(leakState, perLeak, L.sx+0.5, L.sy+0.5, false);
    }

    /* The drip sound. The water is the visual clue and the drip is the audio
       clue, so a player who has been squinting at wet carpet gets a second
       channel. It gets faster as you get closer, so "it is over there" and "it is
       here" sound different. Only the nearest open leak drips, because four at
       once would be a wall of sound with no direction in it. */
    let ld = Infinity, near = null;
    for (const L of leakState.leaks){
      if (L.fixed) continue;
      const d = Math.hypot(p.x-(L.x+0.5), p.y-(L.y+0.5));
      if (d < ld){ ld = d; near = L; }
    }
    if (near && ld < 14){
      leakState.leakDist = Math.min(leakState.leakDist, ld);
      p.dripT = (p.dripT||0) - dt;
      if (p.dripT <= 0){
        // At least 0.28 s between drips. A faster rhythm sounds like a machine gun and not a leak.
        p.dripT = Math.max(0.28, 0.28 + Math.min(1, ld/14)*1.5);
        emit('sfx', 'drip', 1 - Math.min(1, ld/14));
      }
    }
  } else {
    leakState.leakPower = 0;
  }
}

/* ---------- The repair ----------
   Stand still next to an open leak for REPAIR_TIME seconds. Moving drains the
   bar quickly instead of freezing it, so a panic step costs real progress. If
   a mistake cost nothing, the five seconds would be free and the mechanic
   would be a formality.

   The wrench is loud on purpose: you are choosing to stand still and announce
   yourself next to the noisiest thing on the floor.

   @param moving - the player moved this frame.
   @param bumped - the player pushed into a wall this frame. */
export function tickRepair(leakState, dt, moving, bumped){
  const p = leakState.plumber;
  const L = leakAt(leakState.leaks, p.x, p.y);
  leakState.atLeak = !!L;
  if (L){
    if (!moving && !bumped){
      if (L.repair === 0){ L.wrenchT = 0; L.pulseTicks = 0; }
      L.wrenchT = (L.wrenchT||0) - dt;
      if (L.wrenchT <= 0){ emit('sfx', 'wrench', REPAIR_NOISE); L.wrenchT = 1; }
      L.repair = Math.min(REPAIR_TIME, L.repair + dt);
      sustainedNoise(leakState, REPAIR_NOISE, L.sx+0.5, L.sy+0.5, true);
      // The wrench is a steady sound, so it pulses on a beat from the standing spot.
      if (pulseDue(L)) emit('pulse', L.sx+0.5, L.sy+0.5, REPAIR_NOISE);
      if (L.repair >= REPAIR_TIME){
        sealLeak(L, leakState);
      }
    } else {
      /* The bar drains at REPAIR_DECAY whole bars per second. At 2.6 a full bar
         is gone in under half a second. Hesitating at the leak is not a
         strategy, it is a mistake you pay for. */
      L.repair = Math.max(0, L.repair - dt*REPAIR_DECAY*REPAIR_TIME);
      if (L.repair > 0 && L.repair <= 0.001) L.repair = 0;
    }
    if (L.repair > 0) p.stepT = Math.min(p.stepT, dt);
  } else {
    // Away from every leak: any progress still on a leak drains.
    for (const o of leakState.leaks){
      if (o.fixed || o.repair <= 0) continue;
      o.repair = Math.max(0, o.repair - dt*REPAIR_DECAY*REPAIR_TIME);
    }
  }
}