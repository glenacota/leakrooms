/* ============================================================
   SOUND PULSES
   The noise readout. Each sound the plumber makes leaves a ring on the carpet
   where it was made. The ring grows out to the sound's hearing reach, as a full
   circle, and fades. Walking leaves a trail of rings behind you, so the sound you have
   made is visible where it happened, not pinned to your body.

   Ring colour: amber for a quiet sound, red for one at or above LOUD. Loud
   rings also reach further, because their reach is set by their power.

   A dashed circle around the plumber marks the LOUD reach on open floor, the
   distance a LOUD sound carries. It shows while you are making noise.

   The sim only emits 'pulse' events (x, y, power). This pass keeps its own list
   of live rings. Pure visuals, so it may use Math.random if it needs to, though
   it does not.

   Drawn after post-processing, inside the world transform, like the battery
   ring. Nothing darkens it, so it stays readable in the dark.
   ============================================================ */

import { on } from '../../util/events.js';
import { G } from '../../sim/state.js';
import { simAlpha } from './actors.js';
import { ctx, SCALE } from '../canvas.js';
import { hearRadius } from '../../sim/noise.js';
import { TILE, LOUD } from '../../config/constants.js';

/* How long a ring lives, in seconds. Long enough to read a footstep trail, short
   enough that a sprint does not fill the floor with rings. */
const LIFE = 1.2;
/* How long a ring takes to reach its full reach. Quick, so the ring lands on
   the sound rather than trailing it. */
const EXPAND = 0.45;
/* A cap on live rings. A wrench, a radar and a sprint together make about ten
   a second, so this keeps a second or two of trail and no more. */
const MAX_PULSES = 24;
const LINE_W = 1.5;
const FILL_ALPHA = 0.16;
const PULSE_OPACITY = 0.8;

const DANGER = '#d8503c';
const AMBER  = '#e4e6a8';  // the palette's primary yellow

/* The LOUD reach circle is faint and dashed, so it reads as a reference, not a
   sound. */
const REACH_COLOR = 'rgba(228,230,168,0.5)';
const REACH_DASH = [6, 6];
/* Below this self-noise the reach circle stays hidden. Same floor the ring used. */
const REACH_FLOOR = 0.02;
/* Seconds for the reach circle to fade in and out. Same timing as the battery
   ring, so the two HUD items feel like one system. */
const FADE_IN = 0.15;
const FADE_OUT = 0.4;

/* Live rings, oldest first. Each keeps the hearing radius it was given when the
   sound was made. */
const pool = [];
/* How visible the reach circle is, 0 to 1. Render-only. */
let reachAlpha = 0;

/* A new sound starts a ring at its hearing reach. */
on('pulse', (x, y, power) => {
  pool.push({ x, y, power, radius: hearRadius(power), age: 0 });
  if (pool.length > MAX_PULSES) pool.shift();
});

// Moves a fade value toward its target at the fade-in or fade-out speed.
function fade(a, on, dt){
  return on ? Math.min(1, a + dt/FADE_IN) : Math.max(0, a - dt/FADE_OUT);
}

/* One ring: a full circle at the sound's hearing radius, grown by how far it has
   got through its expansion, filled faintly and stroked. `ageAlpha` is how much
   of its life is left, 0 to 1. */
function drawRing(p, ageAlpha){
  const grow = Math.min(1, p.age/EXPAND);
  // Ease out: fast at first, then settling, like a wave front slowing down.
  const k = 1 - (1 - grow)*(1 - grow);
  const col = p.power >= LOUD ? DANGER : AMBER;
  ctx.beginPath();
  ctx.arc(p.x*TILE, p.y*TILE, p.radius*k*TILE, 0, Math.PI*2);
  ctx.fillStyle = col;
  ctx.globalAlpha = ageAlpha*FILL_ALPHA*PULSE_OPACITY;
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = LINE_W;
  ctx.globalAlpha = ageAlpha*PULSE_OPACITY;
  ctx.stroke();
}

/**
 * Draws the sound pulses and the LOUD reach circle.
 * Called once per frame from render(), inside the world transform, before the
 * battery ring.
 *
 * @param {object} rc - the render frame context.
 */
export function pulses(rc){
  const {p, dt} = rc;
  if (!p) return;

  for (let i = pool.length - 1; i >= 0; i--){
    pool[i].age += dt;
    if (pool[i].age >= LIFE) pool.splice(i, 1);
  }
  reachAlpha = fade(reachAlpha, (G.selfNoise || 0) > REACH_FLOOR, dt);
  if (!pool.length && reachAlpha <= 0) return;

  // The same smoothed position the battery ring uses, so the rings stay with the drawn figure.
  const al = simAlpha;
  const px = p.px + (p.x - p.px)*al;
  const py = p.py + (p.y - p.py)*al;

  ctx.save();
  // The pass runs after post(), which leaves the context in device space.
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.translate(rc.tx, rc.ty);
  ctx.globalCompositeOperation = 'source-over';

  if (reachAlpha > 0){
    ctx.globalAlpha = reachAlpha*PULSE_OPACITY;
    ctx.strokeStyle = REACH_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash(REACH_DASH);
    ctx.beginPath();
    ctx.arc(px*TILE, py*TILE, hearRadius(LOUD)*TILE, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const r of pool){
    const ageAlpha = 1 - r.age/LIFE;
    drawRing(r, ageAlpha);
  }
  ctx.restore();
}
