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

/* --- the mix --- */
export function tickAudio(){
  const prox = Math.max(0, 1 - G.nearest/13);
  emit('sfx', 'drone', prox * (0.35 + G.seenBy*0.65));
  /* The two beds. The floor is the NOISE bar itself, so a filling bar is a
     filling room: this is the line that makes the meter true rather than
     decorative. The leak bed is the pipes' total, pulled down by how far the
     nearest one is — the standing hiss you can walk toward. */
  /* The bed follows the loudest thing in earshot — which is what the bar's
     NUMBER shows — while the bar's yellow fill is the player's own share. The
     mix and the meter are both readings of the same frame, neither of them a
     separate mood. */
  emit('sfx', 'noiseFloor', G.noise/NOISE_FS);
  emit('sfx', 'leakBed', G.leakTotal/NOISE_FS, G.leakDist);
}

export function update(dt){
  /* ORDER IS THE DESIGN. The clock first because it can end the frame, then
     the battery, then movement — and everything after movement reads what the
     movement produced: the mask the room you walked into, the flood you are
     standing in, the repair bar that decays because you walked, the things
     that saw you move, and the door you are cycling. Each stage is a function
     with the comment it was written next to; this is only the sequence. */
  /* Snapshot for render interpolation, BEFORE anything moves. The renderer
     draws each entity between its previous step position and this one, which is
     what turns a 1/60s simulation into continuous motion at any refresh rate —
     without this the player visibly advances in 16.7ms jumps on a 144Hz display,
     and a frame-time spike shows up as a teleport rather than as a stride.
     Written on every step rather than derived, because the collision solver can
     refuse a move and `prev` has to be the position that was actually simulated
     from. */
  if (G.player){ G.player.px = G.player.x; G.player.py = G.player.y; }
  for (const a of G.agents){ a.px = a.x; a.py = a.y; }
  if (!tickClock(dt)) return;
  tickBattery(dt);
  const mv = tickMovement(dt);
  G.wet = mv.wet;                  // the tile the player is standing on now

  /* --- room-scoped light ---
     Runs AFTER movement, so the room you just walked into is the room that
     lights up this frame. Checked before, it would lag a frame behind and
     read as the fluorescents chasing you. */
  scopeRoomLight(dt, false);
  fadeRoomLight(dt);
  /* Retrace on any movement, then EASE toward it. Both halves matter: the
     retrace alone still steps a tile at a time, and the easing alone still
     quantises to when the retrace happens.

     Skipped wholesale when the harness has switched vision off. G.scopeDirty is
     deliberately left alone: it is pending work, not stale state, so the first
     frame after vision comes back on recombines whatever the room crossfade
     moved while it was off rather than dropping it. */
  if (wantVision){
    if (traceViewCone(false) || G.scopeDirty){ combineMask(); G.scopeDirty = false; }
    if (smoothMask(dt)) if (G) G.dirty.mask = true;
  }

  /* --- the flood ---
     Runs after movement so the water you are standing in this frame is the
     water you walked into this frame. One pass over the tile array, and only
     over tiles that are within the reachable radius of the leak — the front
     cannot be further than LEAK_SPREAD seconds of travel from the source, so
     the outer ring is skipped entirely instead of being tested and rejected. */
  tickFlood(dt);

  tickLeakNoise(dt);
  tickRepair(dt, mv.moving, mv.bumped);
  tickAgents(dt);
  tickRadarReveal();
  if (!tickDoor(dt)) return;
  tickAudio();
}
