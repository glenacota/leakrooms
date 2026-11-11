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
import { SPRINT_STAMINA, TILE } from '../../config/constants.js';
import { drawBatteryMeter } from '../battery-meter.js';

const STAMINA_CELLS = 5;
const STAMINA_RADIUS = 0.38;
const STAMINA_DANGER = '#d8503c';
const STAMINA_GREEN = '#8fd07a';
const STAMINA_UNLIT = 'rgba(230,235,200,0.18)';
const STAMINA_DISC = 'rgba(12,14,10,0.7)';
const STAMINA_OUTLINE = 'rgba(12,14,10,0.9)';

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
let staminaAlpha = 0;

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

function drawStaminaMeter(cx, cy, stamina){
  const r = STAMINA_RADIUS*TILE;
  const progress = Math.max(0, Math.min(1, stamina/SPRINT_STAMINA));
  const lit = Math.ceil(progress*STAMINA_CELLS - 1e-9);
  const color = stamina === 0 ? STAMINA_DANGER : STAMINA_GREEN;
  const span = TAU/STAMINA_CELLS;
  const trim = 3*Math.PI/180;

  ctx.fillStyle = STAMINA_DISC;
  ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, TAU); ctx.fill();
  ctx.lineWidth = 2;
  for (let i = 0; i < STAMINA_CELLS; i++){
    const a0 = -Math.PI/2 + i*span + trim;
    ctx.strokeStyle = i < lit ? color : STAMINA_UNLIT;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + span - 2*trim);
    ctx.stroke();
  }

  const label = `${Math.ceil(stamina)}s`;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 10px "Courier New", Courier, monospace';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = STAMINA_OUTLINE;
  ctx.strokeText(label, cx, cy);
  ctx.fillStyle = color;
  ctx.fillText(label, cx, cy);
  ctx.restore();
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
  const stamina = G.plumber.stamina;
  const showStamina = stamina < SPRINT_STAMINA;

  battAlpha = fade(battAlpha, radar || pulse, rc.dt);
  staminaAlpha = fade(staminaAlpha, showStamina, rc.dt);

  // The scope's line only turns while the radar is on.
  if (radar) scopeAngle = (scopeAngle + rc.dt*TAU/SCOPE_TURN) % TAU;

  if (battAlpha <= 0 && staminaAlpha <= 0) return;

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
  if (battAlpha > 0){
    ctx.globalAlpha = battAlpha * HUD_OPACITY;
    drawBatteryMeter(ctx, bx, by, batt, radar, scopeAngle);
  }
  if (staminaAlpha > 0){
    ctx.globalAlpha = staminaAlpha * HUD_OPACITY;
    drawStaminaMeter((px - SIDE)*TILE, by, stamina);
  }
  ctx.restore();
}
