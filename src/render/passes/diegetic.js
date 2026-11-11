/* ============================================================
   DIEGETIC HUD
   A radar battery ring pinned to the right of the plumber.
   It fades in when it has something to say and fades out when it does not.
   Ten cells round the ring, one per second of radar, with the percentage 
   inside. Shows while the radar is on, or right after a battery pickup. 
   Green, red when low.

   A vertical tread strip with a running glyph sits to the left. It drains
   smoothly from the top and fades away when stamina is full.

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
import { PAL } from '../../config/palette.js';
import { drawBatteryMeter } from '../battery-meter.js';

const STAMINA_DANGER = '#d8503c';
const STAMINA_GREEN = '#8fd07a';
const STAMINA_UNLIT = 'rgba(230,235,200,0.18)';
const STAMINA_OUTLINE = 'rgba(12,14,10,0.9)';
/* Scale the mockup together so its glyph and tread remain proportional. */
const STAMINA_SCALE = 0.5;
const STAMINA_WIDTH = 14 * STAMINA_SCALE;
const STAMINA_HEIGHT = 42 * STAMINA_SCALE;
const STAMINA_GLYPH = 18 * STAMINA_SCALE;
const STAMINA_GAP = 6 * STAMINA_SCALE;
const STAMINA_TREAD = 6 * STAMINA_SCALE;
const STAMINA_SPACING = 9 * STAMINA_SCALE;
const STAMINA_PADDING = 3 * STAMINA_SCALE;
const STAMINA_SLOPE = -Math.tan(Math.PI/10);

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
  const progress = Math.max(0, Math.min(1, stamina/SPRINT_STAMINA));
  const color = progress < 0.3 ? STAMINA_DANGER : progress < 0.5 ? PAL.bright : STAMINA_GREEN;
  const contentHeight = STAMINA_GLYPH + STAMINA_GAP + STAMINA_HEIGHT
    + Math.abs(STAMINA_SLOPE)*STAMINA_WIDTH/2;
  const top = cy - contentHeight/2;

  ctx.fillStyle = 'rgba(12,14,10,0.7)';
  ctx.fillRect(cx - STAMINA_GLYPH/2 - STAMINA_PADDING, top - STAMINA_PADDING,
    STAMINA_GLYPH + 2*STAMINA_PADDING, contentHeight + 2*STAMINA_PADDING);

  ctx.save();
  ctx.translate(cx - STAMINA_GLYPH/2, top);
  ctx.scale(STAMINA_GLYPH/24, STAMINA_GLYPH/24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(6, 12); ctx.lineTo(8, 9); ctx.lineTo(14, 9);
  ctx.lineTo(10, 15); ctx.lineTo(14, 18); ctx.lineTo(12.5, 21);
  ctx.moveTo(10, 15); ctx.lineTo(8, 18); ctx.lineTo(3.5, 18);
  ctx.moveTo(14, 9); ctx.lineTo(17, 12); ctx.lineTo(20, 10.5);
  ctx.strokeStyle = STAMINA_OUTLINE;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(16, 3.5, 2.5, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.transform(1, STAMINA_SLOPE, 0, 1, cx, top + STAMINA_GLYPH + STAMINA_GAP);
  const drawTreads = () => {
    ctx.beginPath();
    for (let y = STAMINA_HEIGHT - STAMINA_TREAD; y >= 0; y -= STAMINA_SPACING){
      ctx.rect(-STAMINA_WIDTH/2, y, STAMINA_WIDTH, STAMINA_TREAD);
    }
    ctx.fill();
  };
  ctx.fillStyle = STAMINA_UNLIT;
  drawTreads();
  ctx.beginPath();
  ctx.rect(-STAMINA_WIDTH/2, STAMINA_HEIGHT*(1 - progress), STAMINA_WIDTH, STAMINA_HEIGHT*progress);
  ctx.clip();
  ctx.fillStyle = color;
  drawTreads();
  ctx.restore();
}

/**
 * Draws the battery and stamina meters beside the plumber.
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
