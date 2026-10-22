import { emit } from '../util/events.js';
import { tickDoor } from './door.js';
import { tickFlood } from './flood.js';
import { tickLeakNoise, tickRepair } from './leaks.js';
import { NOISE_FS } from '../config/constants.js';
import { tickAgents } from './agents.js';
import { tickClock } from './clock.js';
import { combineMask, fadeRoomLight, scopeRoomLight, smoothMask, traceViewCone, wantVision } from './vision.js';
import { tickRadarReveal } from './radar.js';
import { tickBattery, tickMovement } from './player.js';
import { G } from './state.js';

/* The mix. Sends the audio levels for this frame: the lifeform drone, the noise
   bed (the HUD's noise bar, so the speakers and the meter agree), and the leak
   bed (the pipes' total noise, quieter with distance). */
export function tickAudio(){
  const prox = Math.max(0, 1 - G.nearest/13);
  emit('sfx', 'drone', prox * (0.35 + G.seenBy*0.65));
  // The noise bed follows the loudest thing in earshot, which is the number the bar shows. The yellow fill on the bar is only the player's own share.
  // Ambient mix only: running raises footsteps, not the bed.
  emit('sfx', 'noiseFloor', Math.max(G.ambientNoise, G.leakTotal)/NOISE_FS);
  emit('sfx', 'leakBed', G.leakTotal/NOISE_FS, G.leakDist);
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
 * @param {number} dt - seconds since the last step.
 */
export function update(dt){
  /* G.ended is cleared at the start of every step. lose() sets it part way
     through a step, and the two checks below read it to stop the rest of THAT
     step. It is not what stops the world: the loop stops stepping as soon as
     the run is over. Clearing it here means one bad frame does not condemn the
     floor. */
  G.ended = false;
  /* Remember last step's positions for the renderer, BEFORE anything moves. The
     renderer draws each figure between its previous and current position, which
     turns a 1/60 s simulation into smooth motion at any refresh rate. Without
     this, the player would visibly jump in 16.7 ms steps on a 144 Hz display.
     It is written every step and not worked out later, because collision can
     refuse a move, and `prev` has to be the position that was really simulated
     from. */
  if (G.player){ G.player.px = G.player.x; G.player.py = G.player.y; }
  for (const a of G.agents){ a.px = a.x; a.py = a.y; }
  if (!tickClock(dt)) return;
  tickBattery(G, G.player, G.batteries, dt);
  const mv = tickMovement(G.player, G, G.grid, G.batteries, G, dt);
  G.wet = mv.wet;                  // the tile the player is standing on now

  /* Room-scoped light. It runs AFTER movement, so the room you just walked into
     lights up this frame. Run before movement, it would lag a frame behind and
     look like the lights chasing you. */
  scopeRoomLight(G, G.player, G.radar, dt, false);
  fadeRoomLight(G, dt);
  /* Retrace the cone on any movement, then ease the mask toward it. Both halves
     matter: retracing alone still steps a tile at a time, and easing alone
     still depends on when the retrace happens.

     The whole block is skipped when the tests switch vision off. G.scopeDirty is
     left alone on purpose: it is pending work, so the first frame after vision
     comes back recombines whatever the crossfade moved in the meantime. */
  if (wantVision){
    if (traceViewCone(G, G.player, G.radar, false) || G.scopeDirty){ combineMask(G, G.player, G.radar); G.scopeDirty = false; }
    if (smoothMask(G, dt)) if (G) G.dirty.mask = true;
  }

  // The flood runs after movement, so the water you are standing in is the water you just walked into.
  tickFlood(G, dt);

  tickLeakNoise(dt);
  tickRepair(dt, mv.moving, mv.bumped);
  if (G.ended) return;
  tickAgents(dt);
  /* Once the run has ended, everything below belongs to a run that no longer
     exists. The door is the dangerous one: if you were caught on the threshold it
     would still cycle and build the next floor, so dying at your own front door
     would advance the level at no cost. The same check comes after the repair
     step for the same reason. */
  if (G.ended) return;
  tickRadarReveal();
  if (!tickDoor(dt)) return;
  tickAudio();
}