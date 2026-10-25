import { emit } from '../util/events.js';
import { tickDoor } from './door.js';
import { tickFlood } from './flood.js';
import { tickLeakNoise, tickRepair } from './leaks.js';
import { NOISE_FS } from '../config/constants.js';
import { tickLifeforms } from './lifeforms.js';
import { tickClock } from './clock.js';
import { combineMask, fadeRoomLight, scopeRoomLight, smoothMask, traceViewCone, wantVision } from './vision.js';
import { tickRadarReveal } from './radar.js';
import { tickBattery, tickMovement } from './plumber.js';

/* The mix. Sends the audio levels for this frame: the lifeform drone, the noise
   bed (the HUD's noise bar, so the speakers and the meter agree), and the leak
   bed (the pipes' total noise, quieter with distance). */
export function tickAudio(state){
  const prox = Math.max(0, 1 - state.nearest/13);
  emit('sfx', 'drone', prox * (0.35 + state.seenBy*0.65));
  // The noise bed follows the loudest thing in earshot, which is the number the bar shows. The yellow fill on the bar is only the player's own share.
  // Ambient mix only: running raises footsteps, not the bed.
  emit('sfx', 'noiseFloor', Math.max(state.ambientNoise, state.leakTotal)/NOISE_FS);
  emit('sfx', 'leakBed', state.leakTotal/NOISE_FS, state.leakDist);
}

/**
 * Advances the whole simulation by one step. The loop calls this with a fixed
 * 1/60 s, and the tests call it with any dt.
 *
 * The ORDER of the steps is part of the design:
 *   1. clock       it can end the frame
 *   2. battery
 *   3. movement
 *   4. everything that reads what movement produced: the visible area, the flood
 *      you are standing in, the repair bar (which drains if you moved), the
 *      lifeforms that noticed you, and the door you are cycling
 * Each step is a function in its own file; this is only the sequence.
 *
 * @param {object} state - the aggregate floor state (G)
 * @param {number} dt - seconds since the last step.
 */
export function update(state, dt){
  /* state.ended is cleared at the start of every step. lose() sets it part way
     through a step, and the two checks below read it to stop the rest of THAT
     step. It is not what stops the world: the loop stops stepping as soon as
     the run is over. Clearing it here means one bad frame does not condemn the
     floor. */
  state.ended = false;
  /* Remember last step's positions for the renderer, BEFORE anything moves. The
     renderer draws each figure between its previous and current position, which
     turns a 1/60 s simulation into smooth motion at any refresh rate. Without
     this, the player would visibly jump in 16.7 ms steps on a 144 Hz display.
     It is written every step and not worked out later, because collision can
     refuse a move, and `prev` has to be the position that was really simulated
     from. */
  state.plumber.px = state.plumber.x;
  state.plumber.py = state.plumber.y;
  for (const lf of state.lifeforms){ lf.px = lf.x; lf.py = lf.y; }
  if (!tickClock(state, dt)) return;
  tickBattery(state, state.plumber, state.batteries, dt);
  const mv = tickMovement(state.plumber, state.grid, state, dt);
  state.wet = mv.wet;                  // the tile the plumber is standing on now

  /* Room-scoped light. It runs AFTER movement, so the room you just walked into
     lights up this frame. Run before movement, it would lag a frame behind and
     look like the lights chasing you. */
  scopeRoomLight(state, state.plumber, state.radar, false);
  fadeRoomLight(state, dt);
  /* Retrace the cone on any movement, then ease the mask toward it. Both halves
     matter: retracing alone still steps a tile at a time, and easing alone
     still depends on when the retrace happens.

     The whole block is skipped when the tests switch vision off. state.scopeDirty is
     left alone on purpose: it is pending work, so the first frame after vision
     comes back recombines whatever the crossfade moved in the meantime. */
  if (wantVision){
    if (traceViewCone(state, state.plumber, state.radar, false) || state.scopeDirty){ combineMask(state, state.plumber, state.radar); state.scopeDirty = false; }
    smoothMask(state, dt);
  }

  // The flood runs after movement, so the water you are standing in is the water you just walked into.
  tickFlood(state, dt);

  tickLeakNoise(state, dt);
  tickRepair(state, dt, mv.moving, mv.bumped);
  if (state.ended) return;
  tickLifeforms(state, dt);
  /* Once the run has ended, everything below belongs to a run that no longer
     exists. The door is the dangerous one: if you were caught on the threshold it
     would still cycle and build the next floor, so dying at your own front door
     would advance the level at no cost. The same check comes after the repair
     step for the same reason. */
  if (state.ended) return;
  tickRadarReveal(state);
  if (!tickDoor(state, dt)) return;
  tickAudio(state);
}