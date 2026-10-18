import { DOOR_AJAR, DOOR_EASE, DOOR_HOLD, DOOR_NOISE } from '../config/constants.js';
import { emit } from '../util/events.js';
import { sustainedNoise } from './noise.js';
import { G } from './state.js';

/**
 * The exit door. Once every pipe is sealed, standing at the door for DOOR_HOLD
 * (1.5 s) cycles it open and moves to the next floor. Stepping away drains the
 * progress quickly, so committing to the door is a real decision. With the clock
 * running it is also the last decision of the level.
 *
 * It also animates the door leaf (`e.open`) from the same two facts the HUD
 * shows, so the door in the world matches what the player is doing.
 *
 * @param {number} dt - seconds since the last step.
 * @returns {boolean} false when the door cycled. nextFloor() has already
 *   rebuilt the floor, so the frame must stop there.
 */
export function tickDoor(dt){
  const p = G.player;
  const leakDone = G.leaksOpen === 0;
  let onExit=false;
  if (leakDone){
    for (const e of G.exitTiles){
      // 1.25 tiles: a door in a one-tile alcove is still reachable with the player's 0.33 collision radius, without needing pixel precision.
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
    /* Pipes still open: any cycle progress drains instead of holding, so you
       cannot sit in the doorway with the bar frozen waiting for something that
       has not happened. */
    G.descend = Math.max(0, G.descend - dt*2.5);
  }

  /* The door leaf. Where it swings to depends on the state:
       pipes open      shut (0)
       all sealed      ajar (DOOR_AJAR), so READY reads from across the room
       at the door     follows the hold progress up to fully open
     It eases toward that target, because a leaf that jumps between positions is
     an animation, and this is a door. This runs even on the frame that cycles
     the door only if the code above did not return first, which is correct: the
     floor is being torn down, not drawn once more. */
  const swing = leakDone
    ? (onExit ? DOOR_AJAR + (1-DOOR_AJAR)*(G.descend/DOOR_HOLD) : DOOR_AJAR)
    : 0;
  for (const e of G.exitTiles)
    e.open += (swing - e.open) * Math.min(1, dt*DOOR_EASE);
  return true;
}