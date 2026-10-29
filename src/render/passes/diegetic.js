/* ============================================================
   DIEGETIC HUD
   Two rings pinned to the plumber, one on each side of the body, instead of
   corner gauges. They fade in when they have something to say and fade out
   when they do not:

     noise   — left, speaker glyph. Shows while the plumber is making noise
               (walking, wading, sprinting, repairing, the radar's ping).
               Amber sweep split at LOUD into red, with a threshold tick at
               LOUD and a pulse while loud. A micro "LOUD" tag hovers above
               the ring while loud (and briefly after).
     battery — right, battery glyph. Shows while the radar is on, or right
               after a battery pickup. Green, red when low.

   Each ring sits on a dark disc so it stays readable over a bright floor. The
   glyph says what the ring is, so nobody has to learn the colours. Both are
   drawn with canvas paths (the game has no image assets).

   Drawn LAST, after the post-processing pass (see render.js), inside the world
   transform. Nothing darkens or tints them: not the light bake, not the radar's
   green, not the CRT effects, the vignette or the danger wash. They still
   travel with the camera and stay pinned to the player. They use the same arc
   idiom as the pipe-repair ring (render/passes/leaks.js) and the door crank
   (render/entities.js).
   ============================================================ */

import { G } from '../../sim/state.js';
import { simAlpha } from './actors.js';
import { ctx, SCALE } from '../canvas.js';
import { TAU } from '../../cast/primitives.js';
import { NOISE_FS, LOUD, TILE, BATT_MAX, BATT_LOW } from '../../config/constants.js';

/* How far above the plumber's centre the rings sit, in tiles. */
const BODY_Y = 0.1;
/* How far each ring sits to the side of the plumber's centre, in tiles. The
   plumber's collision radius is 0.33, so the ring edge (0.8 - 0.30) clears the
   body. */
const SIDE = 0.8;
/* Ring radius, in tiles. */
const RING_R = 0.30;
/* Track and sweep thickness, in world pixels. */
const TRACK_LW = 3;
const SWEEP_LW = 2.5;
/* The dark disc behind a ring reaches this many pixels past the track. */
const DISC_PAD = 2;
/* Below this self-noise the noise ring stays hidden. */
const NOISE_FLOOR = 0.02;
/* Seconds for a ring to fade in and out. Quick in, so the ring is there when
   the sound is; slower out, so it does not flicker between footsteps. */
const FADE_IN = 0.15;
const FADE_OUT = 0.4;

/* Fraction of the ring at which the LOUD threshold sits (LOUD / NOISE_FS). */
const LOUD_POS = LOUD / NOISE_FS;
/* How long the micro LOUD tag stays visible after crossing into loud. */
const LOUD_TAG_FOR = 1.0;
/* Extra line-width swing while loud, as a fraction of SWEEP_LW. */
const PULSE_DEPTH = 0.35;

const DANGER = '#d8503c';
const GREEN  = '#8fd07a';  // same green as the door crank: charged
const AMBER  = '#e4e6a8';  // the palette's primary yellow
const TRACK  = 'rgba(20,24,18,0.6)';
const DISC   = 'rgba(12,14,10,0.7)';
const GLYPH_IDLE = 'rgba(228,230,168,0.7)';

/* Seconds remaining that the micro LOUD tag is shown. Module-level because
   the render pass owns this visual effect; nothing in the sim reads it. */
let loudTagT = 0;
/* How visible each ring is, 0 to 1. Render-only, like loudTagT. */
let noiseAlpha = 0;
let battAlpha = 0;

// Moves a fade value toward its target at the fade-in or fade-out speed.
function fade(a, on, dt){
  return on ? Math.min(1, a + dt/FADE_IN) : Math.max(0, a - dt/FADE_OUT);
}

// The dark disc and the faint full track that every ring starts with.
function base(cx, cy){
  const r = RING_R*TILE;
  ctx.fillStyle = DISC;
  ctx.beginPath(); ctx.arc(cx, cy, r + DISC_PAD, 0, TAU); ctx.fill();
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = TRACK_LW;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
}

/* The battery ring: a clockwise sweep from the top that fills as `progress`
   goes 0 -> 1, with a battery glyph in the middle that fills the same way. */
function batteryRing(cx, cy, progress, color){
  const r = RING_R*TILE;
  base(cx, cy);
  if (progress > 0.01){
    ctx.strokeStyle = color;
    ctx.lineWidth = SWEEP_LW;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + progress*TAU);
    ctx.stroke();
  }
  // Glyph: outline, terminal nub on the right, charge bar inside.
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(cx - 6, cy - 3.5, 10, 7);
  ctx.fillRect(cx + 4, cy - 1.5, 1.8, 3);
  ctx.fillRect(cx - 5, cy - 2.5, 8*progress, 5);
}

/* The noise ring: two-tone sweep split at LOUD (amber up to LOUD, red past
   it), a short threshold tick at LOUD, and a pulsed line width while loud.
   A speaker glyph in the middle says what the ring measures. */
function noiseRing(rc, cx, cy, progress, loud){
  const r = RING_R*TILE;
  const loudEnd = -Math.PI/2 + LOUD_POS*TAU;

  base(cx, cy);

  if (progress > 0.01){
    /* Pulse the sweep width when loud, so the ring asks for attention. */
    const pw = loud ? 1 + PULSE_DEPTH*Math.sin(rc.t*0.006) : 1;

    if (progress > LOUD_POS){
      /* Amber segment up to LOUD, then red past it (option C: two-tone). */
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = SWEEP_LW*pw;
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI/2, loudEnd); ctx.stroke();
      ctx.strokeStyle = DANGER;
      ctx.beginPath(); ctx.arc(cx, cy, r, loudEnd, -Math.PI/2 + progress*TAU); ctx.stroke();
    } else {
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = SWEEP_LW*pw;
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + progress*TAU); ctx.stroke();
    }

    /* Threshold tick at LOUD (option A): a short arc sitting on the LOUD
       position, brighter than the track. */
    ctx.strokeStyle = loud ? DANGER : 'rgba(228,230,168,0.55)';
    ctx.lineWidth = SWEEP_LW + 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, loudEnd - 0.10, loudEnd + 0.10);
    ctx.stroke();
  }

  // Glyph: a speaker cone with two sound waves.
  const gc = loud ? DANGER : GLYPH_IDLE;
  ctx.fillStyle = gc;
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 2);
  ctx.lineTo(cx - 2.5, cy - 2);
  ctx.lineTo(cx + 0.5, cy - 5);
  ctx.lineTo(cx + 0.5, cy + 5);
  ctx.lineTo(cx - 2.5, cy + 2);
  ctx.lineTo(cx - 5, cy + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = gc;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx + 0.5, cy, 3.5, -0.9, 0.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + 0.5, cy, 6.5, -0.9, 0.9); ctx.stroke();
}

/* Micro "LOUD" label above the noise ring (option D): shown while loud and
   for up to LOUD_TAG_FOR seconds after crossing back below it. */
function loudTag(rc, cx, cy){
  if (loudTagT <= 0) return;
  const alpha = Math.min(1, loudTagT/LOUD_TAG_FOR);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = DANGER;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = 'bold 9px "Courier New", Courier, monospace';
  ctx.fillText('LOUD', cx, cy - RING_R*TILE - 6);
  ctx.restore();
}

/**
 * Draws the diegetic noise and battery rings beside the plumber.
 * Called once per frame from render(), inside the world transform.
 *
 * @param {object} rc - the render frame context.
 */
export function diegetic(rc){
  const {p} = rc;
  if (!p) return;

  const selfNoise = G.selfNoise || 0;
  const batt = G.batt || 0;
  const radar = !!G.radar;
  const pulse = (G.battPulseT || 0) > 0;

  const loud = selfNoise >= LOUD;
  if (loud) loudTagT = LOUD_TAG_FOR;
  loudTagT = Math.max(0, loudTagT - rc.dt);

  noiseAlpha = fade(noiseAlpha, selfNoise > NOISE_FLOOR, rc.dt);
  battAlpha = fade(battAlpha, radar || pulse, rc.dt);
  if (noiseAlpha <= 0 && battAlpha <= 0) return;

  /* Smoothed position, the same interpolation the actors pass uses, so the
     rings stay locked to the plumber's drawn figure rather than snapping. */
  const al = simAlpha;
  const px = p.px + (p.x - p.px)*al;
  const py = p.py + (p.y - p.py)*al;

  /* Either side of the body: noise on the left, battery on the right. */
  const cy = (py - BODY_Y)*TILE;
  const nx = (px - SIDE)*TILE;
  const bx = (px + SIDE)*TILE;

  ctx.save();
  /* The pass runs after post(), which leaves the context in device space, so
     the world transform is set up here, and only when something is drawn. */
  ctx.setTransform(SCALE,0,0,SCALE,0,0);
  ctx.translate(rc.tx, rc.ty);
  ctx.globalCompositeOperation = 'source-over';
  if (noiseAlpha > 0){
    ctx.globalAlpha = noiseAlpha;
    const progress = Math.min(1, selfNoise/NOISE_FS);
    noiseRing(rc, nx, cy, progress, loud);
    loudTag(rc, nx, cy);
  }
  if (battAlpha > 0){
    ctx.globalAlpha = battAlpha;
    const progress = Math.min(1, Math.max(0, batt/BATT_MAX));
    batteryRing(bx, cy, progress, batt < BATT_LOW ? DANGER : GREEN);
  }
  ctx.restore();
}
