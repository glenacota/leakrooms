import { LEAK_NOISE_BASE, LEAK_NOISE_GAIN, LOUD, MAP_W, REPAIR_NOISE, REPAIR_REACH } from '../config/constants.js';
import { REPAIR_TIME } from '../config/tuning.js';
import { emit } from '../util/events.js';
import { sustainedNoise } from './noise.js';

/**
 * Leak state bundle passed by reference.
 * @typedef {{
 *   leaks: Array<{x:number,y:number,sx:number,sy:number,fixed:boolean,repair:number,repairing?:boolean,fixedAt:number,wrenchT:number}>,
 *   openLeaks: number,
 *   plumber: {x:number,y:number},
 *   time: number,
 *   floodCover: number,
 *   leakPower: number,
 *   leakTotal: number,
 *   leakDist: number,
 *   stat: {noises:number, deaths:number, sealed:number},
 *   atLeak: boolean
 * }} LeakState
 */

/** Returns whether the stored open-leak count is positive. */
export function hasOpenLeaks(state){
  return state.openLeaks > 0;
}

/** Returns the standing tile indices of open leaks, in leak order. */
export function openLeakSpots(state){
  return state.leaks.filter(L => !L.fixed).map(L => L.sy*MAP_W + L.sx);
}

/** Returns the first open leak strictly within range of its standing spot. */
export function firstOpenLeakWithin(state, x, y, maxDist){
  for (const L of state.leaks){
    if (!L.fixed && standingDistance(L, x, y) < maxDist) return L;
  }
  return null;
}

/** Returns the nearest open leak and its standing-spot distance, or null. */
export function nearestOpenLeak(state, x, y){
  let nearest = null, distance = Infinity;
  for (const L of state.leaks){
    if (L.fixed) continue;
    const d = standingDistance(L, x, y);
    if (d < distance){ nearest = L; distance = d; }
  }
  return nearest ? { leak: nearest, distance } : null;
}

function standingDistance(L, x, y){
  return Math.hypot(x-(L.sx+0.5), y-(L.sy+0.5));
}

/** Restores sealed leaks after a same-seed floor rebuild, without emitting events. */
export function restoreSealed(state, wasFixed){
  state.leaks.forEach((L, i) => {
    if (!wasFixed[i]) return;
    L.fixed = true;
    L.fixedAt = 0;
    L.repair = 0;
  });
  state.openLeaks = state.leaks.filter(L => !L.fixed).length;
}

/* Returns the open leaks the player is close enough to work on, or null.
   Distance is measured to the standing spot, since the interaction is "put
   your hands on the pipe". */
export function leakAt(leaks, x, y){
  for (const L of leaks){
    if (L.fixed) continue;
    if (standingDistance(L, x, y) < REPAIR_REACH) return L;
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
 * Sealing one leak stops it feeding the flood. Its own front starts to recede
 * toward the pipe, and the water only that pipe was reaching dries. Water the
 * open pipes still reach stays wet, so sealing one leak out of four is progress.
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
  L.repairing = false;
  leakState.openLeaks = Math.max(0, leakState.openLeaks-1);
  emit('sfx', 'seal');
  emit('flash', leakState.openLeaks
    ? { cat: 'info', text: `LEAK SEALED \u2014 ${leakState.openLeaks} STILL OPEN` }
    : { cat: 'guide', text: 'EVERY LEAK SEALED \u2014 GET BACK TO THE DOOR' });
  leakState.stat.sealed++;
  emit('stat', 'sealed');
  /* The recession uses the existing fields. Rebuilding them from the seal point
     would reset the fronts and snap the level from flooded to dry in a single
     frame. The sealed pipe's front simply starts moving back toward it. */
  emit('waterChanged');
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
    const near = nearestOpenLeak(leakState, p.x, p.y);
    if (near && near.distance < 14){
      const ld = near.distance;
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
   Stand still next to an open leak for REPAIR_TIME seconds. Breaking contact
   pauses the work but preserves progress on that leak, so a panic step costs
   time and exposes the plumber without erasing work already done.

   The wrench is loud on purpose: you are choosing to stand still and announce
   yourself next to the noisiest thing on the floor.

   @param moving - the player moved this frame.
   @param bumped - the player pushed into a wall this frame. */
export function tickRepair(leakState, dt, moving, bumped){
  const p = leakState.plumber;
  const L = leakAt(leakState.leaks, p.x, p.y);
  leakState.atLeak = !!L;
  for (const leak of leakState.leaks) leak.repairing = false;
  if (L){
    if (!moving && !bumped){
      L.repairing = true;
      if (L.repair === 0) L.wrenchT = 0;
      L.wrenchT = (L.wrenchT||0) - dt;
      if (L.wrenchT <= 0){ emit('sfx', 'wrench', REPAIR_NOISE); L.wrenchT = 1; }
      L.repair = Math.min(REPAIR_TIME, L.repair + dt);
      sustainedNoise(leakState, REPAIR_NOISE, L.sx+0.5, L.sy+0.5, true);
      if (L.repair >= REPAIR_TIME){
        sealLeak(L, leakState);
      }
    }
    if (L.repair > 0) p.stepT = Math.min(p.stepT, dt);
  }
}