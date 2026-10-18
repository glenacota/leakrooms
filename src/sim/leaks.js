import { LEAK_NOISE_BASE, LEAK_NOISE_GAIN, LOUD, REPAIR_DECAY, REPAIR_NOISE, REPAIR_REACH } from '../config/constants.js';
import { REPAIR_TIME } from '../config/tuning.js';
import { emit } from '../util/events.js';
import { sustainedNoise } from './noise.js';
import { G } from './state.js';

/* A pipe has two positions:
     L.x, L.y    the wall tile the pipe is broken in
     L.sx, L.sy  the floor tile you stand on to repair it (the "standing spot")
   Reach, noise and lures all use the standing spot, because that is the
   pipe's one address that a person or a lifeform can actually walk to. */

/* Returns the open pipe the player is close enough to work on, or null.
   Distance is measured to the standing spot, since the interaction is "put
   your hands on the pipe". */
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

/**
 * Seals one pipe permanently. It checks the fixed flag first, so it can never
 * be applied twice.
 *
 * Sealing one pipe does not stop the flood: the water only starts to recede when
 * the LAST pipe is sealed. So sealing one pipe out of four is progress, not
 * relief.
 *
 * @param {object} L - an entry of G.leaks.
 */
export function sealLeak(L){
  if (!L || L.fixed) return;
  L.fixed = true;
  L.fixedAt = G.time;
  // Clear the progress bar, so a number that means "work in progress" does not sit at 100% forever.
  L.repair = 0;
  G.leaksOpen = Math.max(0, G.leaksOpen-1);
  emit('sfx', 'seal', );
  emit('flash', G.leaksOpen
    ? `PIPE SEALED \u2014 ${G.leaksOpen} STILL OPEN`
    : 'EVERY PIPE SEALED \u2014 GET BACK TO THE DOOR');
  G.stat.sealed++;
  emit('stat', 'sealed');
  /* The recession uses the existing distance field. Building a new field from
     the seal point would reset the water front and snap the level from flooded
     to dry in a single frame. The existing field already describes the right
     answer: water recedes from where it spread. */
  if (G) G.dirty.water = true;
}

/* ---------- Noise from open pipes ----------
   Every open pipe is a continuous noise source at its standing spot. This uses
   sustainedNoise and not repeated one-off noises, because a standing sound is
   what a lifeform can walk toward. */
export function tickLeakNoise(dt){
  const p = G.player;
  /* G.leakTotal is the building's standing noise: the sum of what the open
     pipes make right now. The HUD draws it as the blue part of the noise bar and
     the audio plays it, so the number the lifeform hears is the number the
     player can see. */
  G.leakTotal = 0;
  G.leakDist  = 99;
  if (G.leaksOpen > 0){
    /* Each pipe gets louder as the floor floods, but the TOTAL is kept below
       LOUD. Above LOUD the leak would stop being a lure and become a hunt
       trigger for the whole floor, and the wrench would no longer be the
       loudest thing you can do. So each pipe's share is divided by how many are
       open.

       G.floodCover is the running sum kept by tickFlood. It is not recomputed
       here, because adding a 5776-tile loop to every frame of every level for a
       number that is already available is what made the test suite slow. */
    const each = Math.min(LEAK_NOISE_BASE + LEAK_NOISE_GAIN*G.floodCover,
                          (LOUD-0.02)/G.leaksOpen);
    G.leakPower = each;
    G.leakTotal = each * G.leaksOpen;
    for (const L of G.leaks){
      if (L.fixed) continue;
      /* The noise comes from the standing spot (floor), not the wall the pipe is
         broken in. alert() gives this coordinate to a lifeform as its target, and
         a target inside a wall would leave it standing and bumping against
         brick. */
      sustainedNoise(each, L.sx+0.5, L.sy+0.5);
    }

    /* The drip sound. The water is the visual clue and the drip is the audio
       clue, so a player who has been squinting at wet carpet gets a second
       channel. It gets faster as you get closer, so "it is over there" and "it is
       here" sound different. Only the nearest open pipe drips, because four at
       once would be a wall of sound with no direction in it. */
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
        // At least 0.28 s between drips. A faster rhythm sounds like a machine gun and not a pipe.
        p.dripT = Math.max(0.28, 0.28 + Math.min(1, ld/14)*1.5);
        emit('sfx', 'drip', 1 - Math.min(1, ld/14));
      }
    }
  } else {
    G.leakPower = 0;
  }
}

/* ---------- The repair ----------
   Stand still next to an open pipe for REPAIR_TIME seconds. Moving drains the
   bar quickly instead of freezing it, so a panic step costs real progress. If
   a mistake cost nothing, the five seconds would be free and the mechanic
   would be a formality.

   The wrench is loud on purpose: you are choosing to stand still and announce
   yourself next to the noisiest thing on the floor.

   @param moving - the player moved this frame.
   @param bumped - the player pushed into a wall this frame. */
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
      /* The bar drains at REPAIR_DECAY whole bars per second. At 2.6 a full bar
         is gone in under half a second. Hesitating at the pipe is not a
         strategy, it is a mistake you pay for. */
      L.repair = Math.max(0, L.repair - dt*REPAIR_DECAY*REPAIR_TIME);
      if (L.repair > 0 && L.repair <= 0.001) L.repair = 0;
    }
    if (L.repair > 0) p.stepT = Math.min(p.stepT, dt);
  } else {
    // Away from every pipe: any progress still on a pipe drains.
    for (const o of G.leaks){
      if (o.fixed || o.repair <= 0) continue;
      o.repair = Math.max(0, o.repair - dt*REPAIR_DECAY*REPAIR_TIME);
    }
  }
}