import { LEAK_NOISE_BASE, LEAK_NOISE_GAIN, LOUD, REPAIR_DECAY, REPAIR_NOISE, REPAIR_REACH } from '../config/constants.js';
/* REPAIR_TIME is TUNABLE, not a constant — applyDifficulty rewrites it, so the
   five seconds the repair bar is measured against is whatever the difficulty
   says it is. Imported as a live binding on purpose. */
import { REPAIR_TIME } from '../config/tuning.js';
import { emit } from '../util/events.js';
import { sustainedNoise } from './noise.js';
import { G } from './state.js';

/* Is the player close enough to an OPEN pipe to work on it? Measured against
   the standing spot, not the tile the face was picked from, because the whole
   interaction is "put your hands on the pipe" and a repair you can trigger
   from a diagonal tile away is not that. Returns the pipe itself so the
   caller does not have to search again. */
export function leakAt(x, y){
  for (const L of G.leaks){
    if (L.fixed) continue;
    if (Math.hypot(L.sx+0.5-x, L.sy+0.5-y) < REPAIR_REACH) return L;
  }
  return null;
}
export function leakReach(x, y){
  return !!leakAt(x, y);
}

/* Seal one pipe. Permanent, once per pipe — the flag is checked before the
   progress bar is ever allowed to advance, so this cannot be double-applied
   and cannot leave the pipe flooded with a full progress bar. */
export function sealLeak(L){
  if (!L || L.fixed) return;
  L.fixed = true;
  L.fixedAt = G.time;
  /* The bar goes with it. Leaving a full progress bar on a sealed pipe is
     harmless today because the ring is gated on !fixed — but it is a number
     that means "work in progress" sitting at 100% forever, and the first thing
     that reads it as something else will be wrong. */
  L.repair = 0;
  G.leaksOpen = Math.max(0, G.leaksOpen-1);
  emit('sfx', 'seal', );
  /* The recession only starts when the LAST pipe is closed, so the water keeps
     advancing between the first repair and the fourth. That is deliberate: it
     means sealing one pipe out of four is progress and not relief, and the floor
     does not stop drowning the moment you feel good about yourself. */
  emit('flash', G.leaksOpen
    ? `PIPE SEALED \u2014 ${G.leaksOpen} STILL OPEN`
    : 'EVERY PIPE SEALED \u2014 GET BACK TO THE DOOR');
  G.stat.sealed++;
  emit('stat', 'sealed');
  /* Recompute the distance field from the seal point so the recession runs
     outward from where the work happened rather than from the pipe. It is a
     visual difference, but it is the difference between water receding from
     the thing you fixed and water receding from somewhere off screen. */
  /* The recession runs off the EXISTING distance field, not a new one from the
     seal point. That was the first version and it was wrong: re-deriving the
     field re-sorts the ordering, which resets the front to "nothing is wet"
     and the level would snap from flooded to dry on the frame you fixed the
     pipe — the single most visible bug available in this feature. The field is
     already the right answer: water recedes from where it spread. */
  if (G) G.dirty.water = true;
}

/* --- the pipes ---
   Every open one is a continuous emitter at the pipe, not a repeating one-shot.
   sustainedNoise rather than emitNoise: a burst every few frames would inflate
   the noise stats and fight the meter decay, and what this needs to be is a
   standing sound the Lifeform can walk toward, not a series of events. */
export function tickLeakNoise(dt){
  const p = G.player;
  /* The building's total standing noise: what the open pipes are making right
     now, everywhere, summed. The HUD draws it as the water-blue floor under the
     bar and the leak bed plays it, so the number the Lifeform hears is the
     number the player can see. */
  G.leakTotal = 0;
  G.leakDist  = 99;
  if (G.leaksOpen > 0){
    /* Power rises with how much of the level is under water, so the leak gets
       louder as the floor drowns — but it is clamped below LOUD no matter how
       bad it gets. Above LOUD this stops being a lure and becomes a level-wide
       hunt trigger, and the repair would have nothing left to be tense
       against.

       FOUR OPEN PIPES MUST NOT BE FOUR LOUD PIPES. The share each one gets is
       divided by how many are open, so the building's total background hiss
       still tops out under LOUD: it stays a lure you can hide behind rather than
       a hunt trigger you cannot switch off, and it keeps the wrench the single
       loudest thing you can do — which is the deal the whole stealth layer rests
       on. Above LOUD you would be sealing pipes with a floor-wide hunt running,
       which is a different game and a worse one.

       G.floodCover is the incremental sum maintained by tickFlood, NOT a fresh
       pass over the tile array. Recomputing it here instead — which the first
       version did — re-adds a 5776-element loop to every frame of every level
       for a number that was already sitting on G, and it is the difference
       between the suite finishing in seventy seconds and not finishing. */
    const each = Math.min(LEAK_NOISE_BASE + LEAK_NOISE_GAIN*G.floodCover,
                          (LOUD-0.02)/G.leaksOpen);
    G.leakPower = each;
    G.leakTotal = each * G.leaksOpen;
    for (const L of G.leaks){
      if (L.fixed) continue;
      /* FROM THE STAND TILE, not from the wall the pipe is broken in. L.x/L.y
         is the masonry and L.sx/L.sy is the floor you stand on to wrench it, and
         the noise used to be emitted from the masonry: the distance was measured
         to a wall, and — the part that actually mattered — alert() hands that
         coordinate straight to the entity as its target, so a Lifeform curious
         about a pipe was told to walk to the inside of a wall and stood there
         bumping its own collision disc against brick. LEAK_LURE and leakAt both
         read sx,sy: the pipe has exactly one address, and it is the floor. */
      sustainedNoise(each, L.sx+0.5, L.sy+0.5);
    }

    /* Dripping, audible near the pipes. This is the find-confirmation cue and
       it is deliberately a SOUND and not a marker: the water is the visual
       cue and the drip is the audio one, so a player who has been squinting
       at wet carpet for two minutes gets a second channel at the moment the
       visual channel has already done its job. Rate scales with closeness so
       "it is over there somewhere" and "it is here" are distinguishable
       without looking up. Only the NEAREST open pipe drips — four of them
       chattering at once is a wall of sound with no position in it. */
    let ld = Infinity, near = null;
    for (const L of G.leaks){
      if (L.fixed) continue;
      const d = Math.hypot(p.x-(L.x+0.5), p.y-(L.y+0.5));
      if (d < ld){ ld = d; near = L; }
    }
    if (near && ld < 14){
      G.leakDist = Math.min(G.leakDist, ld);
      p.dripT = (p.dripT||0) - dt;
      if (p.dripT <= 0){
        /* The floor on the interval is 0.28s. It used to reach 0.10 at the pipe
           itself — ten drips a second, a machine gun with no pitch and no room
           in it, which is the opposite of the positional cue it exists to be.
           Loud and slow reads as "a pipe"; fast and loud reads as a texture. */
        p.dripT = Math.max(0.28, 0.28 + Math.min(1, ld/14)*1.5);
        emit('sfx', 'drip', 1 - Math.min(1, ld/14));
      }
    }
  } else {
    G.leakPower = 0;
  }
}

/* --- the repair ---
   Hold still next to the pipe for five seconds. Moving decays the bar rather
   than freezing it, so a panic step costs real progress instead of just
   costing you the second — the failure has to cost something or the five
   seconds are free and the whole mechanic is a formality.

   The wrench is LOUD, which is the deal. You are choosing to stand immobile
   and announce yourself, next to the noisiest thing on the floor, with
   something already on its way. */
export function tickRepair(dt, moving, bumped){
  const p = G.player;
  const L = leakAt(p.x, p.y);
  G.atLeak = !!L;
  if (L){
    if (!moving && !bumped){
      if (L.repair === 0) emit('sfx', 'wrench', REPAIR_NOISE);
      L.repair = Math.min(REPAIR_TIME, L.repair + dt);
      sustainedNoise(REPAIR_NOISE, L.sx+0.5, L.sy+0.5, true);
      if (L.repair >= REPAIR_TIME){
        sealLeak(L);
      }
    } else {
      /* Decays at REPAIR_DECAY whole bars per second: leaving after four
         seconds throws away the lot, because 2.6/s means you are gone in under
         half a second. That is deliberate. Hesitating at the pipe is not a
         strategy, it is a mistake you have to pay for. */
      L.repair = Math.max(0, L.repair - dt*REPAIR_DECAY*REPAIR_TIME);
      if (L.repair > 0 && L.repair <= 0.001) L.repair = 0;
    }
    if (L.repair > 0) p.stepT = Math.min(p.stepT, dt);
  } else {
    /* Off the pipe entirely: every bar still on any pipe starts bleeding. */
    for (const o of G.leaks){
      if (o.fixed || o.repair <= 0) continue;
      o.repair = Math.max(0, o.repair - dt*REPAIR_DECAY*REPAIR_TIME);
    }
  }
}