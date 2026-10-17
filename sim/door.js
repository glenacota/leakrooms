import { DOOR_AJAR, DOOR_EASE, DOOR_HOLD, DOOR_NOISE } from '../config/constants.js';
import { emit } from '../util/events.js';
import { sustainedNoise } from './noise.js';
import { G } from './state.js';

/* --- the door ---
   Hold at it for 1.5s and it cycles open. Step away and the progress drains
   fast, so committing to the door is a real decision — and with a clock
   running it is the last decision of the level.

   Returns false when the door cycled: nextFloor() has already rebuilt the
   floor and the frame must stop there, as it did when this code sat inline. */
export function tickDoor(dt){
  const p = G.player;
  const leakDone = G.leaksOpen === 0;
  let onExit=false;
  if (leakDone){
    for (const e of G.exitTiles){
      // 1.25 tiles: a door in a 1-wide alcove is still reachable with the
      // player's 0.33 collision radius, without demanding pixel precision.
      if (Math.hypot(e.x+0.5-p.x, e.y+0.5-p.y) < 1.25){ onExit=true; break; }
    }
    if (onExit){
      if (G.descend===0) emit('sfx', 'door', DOOR_NOISE);
      G.descend += dt;
      sustainedNoise(DOOR_NOISE, p.x, p.y, true);
      if (G.descend>=DOOR_HOLD){ emit('door:cycled'); return false; }
    } else {
      G.descend = Math.max(0, G.descend - dt*2.5);
    }
  } else if (G.descend > 0){
    /* Backing off: if the door was open and a pipe is still open, the cycle
       drains rather than holding. You cannot sit in a doorway with the
       progress bar frozen waiting for something that has not happened. */
    G.descend = Math.max(0, G.descend - dt*2.5);
  }

  /* THE LEAF.
     `e.open` was set to 0 when the door was placed and never written again, so
     every door on every floor rendered permanently shut: the renderer read a
     value that could not change, and the entire open/shut difference was
     stroke alpha on the word DOOR. This is the field it was always waiting
     for — the swing itself, derived from the same two facts the HUD reads.

     It runs even when the frame is about to end (nextFloor above returns
     before this, and that is correct: the floor is being torn down, not
     rendered one more time). Eased rather than assigned, because a leaf that
     teleports between three positions is an animation, and this is a door. */
  const swing = leakDone
    ? (onExit ? DOOR_AJAR + (1-DOOR_AJAR)*(G.descend/DOOR_HOLD) : DOOR_AJAR)
    : 0;
  for (const e of G.exitTiles)
    e.open += (swing - e.open) * Math.min(1, dt*DOOR_EASE);
  return true;
}
