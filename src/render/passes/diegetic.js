/* ============================================================
   DIEGETIC HUD
   Two small rings anchored to the plumber, just above the head,
   instead of corner gauges. They only light up when they have
   something to say:

     noise   — while the plumber is making noise (walking, wading,
               sprinting, repairing). Amber, red at/above LOUD.
     battery — while the radar is on, or right after a battery pickup.
               Green, red when low.

   Drawn inside the world transform, so they travel with the camera
   and stay pinned to the player. They use the same arc idiom as the
   pipe-repair ring (render/passes/leaks.js) and the door crank
   (render/entities.js).
   ============================================================ */

import { G } from '../../sim/state.js';
import { simAlpha } from './actors.js';
import { ctx } from '../canvas.js';
import { TAU } from '../../cast/primitives.js';
import { NOISE_FS, LOUD, TILE, BATT_MAX, BATT_LOW } from '../../config/constants.js';

/* How far above the plumber's centre the rings sit, in tiles. */
const HEAD_Y = 0.6;
/* Centre-to-centre spacing of the two rings, in tiles. */
const RING_SPACING = 0.5;
/* Ring radius, in tiles. */
const RING_R = 0.22;
/* Track and sweep thickness, in world pixels. */
const TRACK_LW = 2.5;
const SWEEP_LW = 2;
/* Below this self-noise the noise ring stays dark. */
const NOISE_FLOOR = 0.02;
/* A battery pickup keeps the battery ring lit this many seconds. */
const PULSE_FOR = 1;

const DANGER = '#d8503c';
const GREEN  = '#8fd07a';  // same green as the door crank: charged
const AMBER  = '#e4e6a8';  // the palette's primary yellow
const TRACK  = 'rgba(20,24,18,0.6)';

/* One ring: a faint full track plus a clockwise sweep from the top that fills
   as `progress` goes 0 -> 1. Nothing is drawn when progress is effectively 0,
   so an idle ring is just a dim track. */
function ring(cx, cy, progress, color){
  const r = RING_R*TILE;
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = TRACK_LW;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  if (progress <= 0.01) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = SWEEP_LW;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + progress*TAU);
  ctx.stroke();
}

/**
 * Draws the diegetic noise and battery rings above the plumber.
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

  const showNoise = selfNoise > NOISE_FLOOR;
  const showBatt = radar || pulse;
  if (!showNoise && !showBatt) return;

  /* Smoothed position, the same interpolation the actors pass uses, so the
     rings stay locked to the plumber's drawn figure rather than snapping. */
  const al = simAlpha;
  const px = p.px + (p.x - p.px)*al;
  const py = p.py + (p.y - p.py)*al;

  /* Just above the head, side by side: noise on the left, battery on the right. */
  const cy = (py - HEAD_Y)*TILE;
  const nx = (px - RING_SPACING/2)*TILE;
  const bx = (px + RING_SPACING/2)*TILE;

  ctx.save();
  if (showNoise){
    const progress = Math.min(1, selfNoise/NOISE_FS);
    ring(nx, cy, progress, selfNoise >= LOUD ? DANGER : AMBER);
  }
  if (showBatt){
    const progress = Math.min(1, Math.max(0, batt/BATT_MAX));
    ring(bx, cy, progress, batt < BATT_LOW ? DANGER : GREEN);
  }
  ctx.restore();
}
