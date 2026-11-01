/* ============================================================
   DIEGETIC HUD
   A radar battery ring pinned to the right of the plumber.
   It fades in when it has something to say and fades out when it does not.
   Ten cells round the ring, one per second of radar, with the percentage 
   inside. Shows while the radar is on, or right after a battery pickup. 
   Green, red when low.

   Drawn LAST, after the post-processing pass (see render.js), inside the world
   transform. Nothing darkens or tints it: not the light bake, not the radar's
   green, not the CRT effects, the vignette or the danger wash. It still
   travels with the camera and stays pinned to the player.
   ============================================================ */

import { G } from '../../sim/state.js';
import { simAlpha } from './actors.js';
import { ctx, SCALE } from '../canvas.js';
import { TAU } from '../../cast/primitives.js';
import { TILE } from '../../config/constants.js';
import { drawBatteryMeter } from '../battery-meter.js';

/* How far above the plumber's centre the battery ring sits, in tiles. */
const BATT_Y = 0.3;
/* How far the ring sits to the right of the plumber's centre, in tiles. The
   plumber's collision radius is 0.33. */
const SIDE = 1;
/* Seconds for the ring to fade in and out. Quick in, so the ring is there when
   the radar is; slower out, so it does not flicker. */
const FADE_IN = 0.15;
const FADE_OUT = 0.4;

/* The diegetic HUD (rings, discs, sweeps, glyphs, scope, tags) opacity. */
const HUD_OPACITY = 0.75;

/* How visible the battery ring is, 0 to 1. Render-only. */
let battAlpha = 0;

/* The radar scope inside the battery ring, drawn faint behind the label: a line that turns once every
   SCOPE_TURN seconds, dragging a fading trail SCOPE_TRAIL radians long behind
   it, like a radar screen. It only turns while the radar is on, so it shows the
   radar is live; with the radar off (right after a battery pickup) the scope is
   just its faint rings and crosshair. */
const SCOPE_TURN = 1.4;
let scopeAngle = 0;

// Moves a fade value toward its target at the fade-in or fade-out speed.
function fade(a, on, dt){
  return on ? Math.min(1, a + dt/FADE_IN) : Math.max(0, a - dt/FADE_OUT);
}

/**
 * Draws the battery ring beside the plumber.
 * Called once per frame from render(), inside the world transform.
 *
 * @param {object} rc - the render frame context.
 */
export function diegetic(rc){
  const {p} = rc;
  if (!p) return;

  const batt = G.batt || 0;
  const radar = !!G.radar;
  const pulse = (G.battPulseT || 0) > 0;

  battAlpha = fade(battAlpha, radar || pulse, rc.dt);

  // The scope's line only turns while the radar is on.
  if (radar) scopeAngle = (scopeAngle + rc.dt*TAU/SCOPE_TURN) % TAU;

  if (battAlpha <= 0) return;

  /* Smoothed position, the same interpolation the actors pass uses, so the
     ring stays locked to the plumber's drawn figure rather than snapping. */
  const al = simAlpha;
  const px = p.px + (p.x - p.px)*al;
  const py = p.py + (p.y - p.py)*al;

  const by = (py - BATT_Y)*TILE;
  const bx = (px + SIDE)*TILE;

  ctx.save();
  /* The pass runs after post(), which leaves the context in device space, so
     the world transform is set up here, and only when something is drawn. */
  ctx.setTransform(SCALE,0,0,SCALE,0,0);
  ctx.translate(rc.tx, rc.ty);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = battAlpha * HUD_OPACITY;
  drawBatteryMeter(ctx, bx, by, batt, radar, scopeAngle);
  ctx.restore();
}
