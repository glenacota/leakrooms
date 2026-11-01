/* ============================================================
   DIEGETIC HUD
   A radar ring pinned to the right of the plumber, instead of a corner gauge.
   It fades in when it has something to say and fades out when it does not.

     battery — right. Ten cells round the ring, one per second of radar, with
               the percentage inside. Shows while the radar is on, or right
               after a battery pickup. Green, red when low.

   The ring sits on a dark disc so it stays readable over a bright floor. It
   is drawn with canvas paths (the game has no image assets).

   Drawn LAST, after the post-processing pass (see render.js), inside the world
   transform. Nothing darkens or tints it: not the light bake, not the radar's
   green, not the CRT effects, the vignette or the danger wash. It still
   travels with the camera and stays pinned to the player. It uses the same arc
   idiom as the pipe-repair ring (render/passes/leaks.js) and the door crank
   (render/entities.js).
   ============================================================ */

import { G } from '../../sim/state.js';
import { simAlpha } from './actors.js';
import { ctx, SCALE } from '../canvas.js';
import { TAU } from '../../cast/primitives.js';
import { TILE, BATT_MAX, BATT_CELLS, BATT_LOW } from '../../config/constants.js';

/* How far above the plumber's centre the battery ring sits, in tiles. It is
   lower than the ripples' origin, so the two never overlap. */
const BATT_Y = -0.3;
/* How far the ring sits to the right of the plumber's centre, in tiles. The
   plumber's collision radius is 0.33, so the ring's outer edge (0.9 - 0.45 -
   half a band) clears the body. */
const SIDE = 0.9;
/* Radius of the cells' centre line, in tiles. Big enough for "100%" inside. */
const RING_R = 0.45;
/* Cell thickness, in world pixels. */
const CELL_LW = 5;
/* Each cell spans 36 degrees; this much is trimmed off both ends so the cells
   read as separate steps. */
const CELL_SPAN = TAU/BATT_CELLS;
const CELL_TRIM = 3*Math.PI/180;
/* The dark disc behind the ring reaches this many pixels past the cells. */
const DISC_PAD = 2;
/* Seconds for the ring to fade in and out. Quick in, so the ring is there when
   the radar is; slower out, so it does not flicker. */
const FADE_IN = 0.15;
const FADE_OUT = 0.4;

const DANGER = '#d8503c';
const GREEN  = '#8fd07a';  // same green as the door crank: charged
const UNLIT  = 'rgba(230,235,200,0.18)';
const DISC   = 'rgba(12,14,10,0.7)';
const SCOPE_FACE = 'rgba(143,208,122,0.35)';
/* The diegetic HUD (rings, discs, sweeps, glyphs, scope, tags) runs at 90%
   opacity so it reads without fighting the floor brightness behind it. */
const HUD_OPACITY = 0.8;

/* How visible the battery ring is, 0 to 1. Render-only. */
let battAlpha = 0;

/* The radar scope inside the battery ring, drawn faint behind the label: a line that turns once every
   SCOPE_TURN seconds, dragging a fading trail SCOPE_TRAIL radians long behind
   it, like a radar screen. It only turns while the radar is on, so it shows the
   radar is live; with the radar off (right after a battery pickup) the scope is
   just its faint rings and crosshair. */
const SCOPE_TURN = 1.4;
const SCOPE_TRAIL = 1.2;
const SCOPE_BANDS = 10;
/* How far the scope reaches, as a share of the cells' inner radius. */
const SCOPE_REACH = 0.8;
/* The scope is a backdrop; this keeps it from fighting the percentage. */
const SCOPE_FADE = 0.4;
let scopeAngle = 0;

// Moves a fade value toward its target at the fade-in or fade-out speed.
function fade(a, on, dt){
  return on ? Math.min(1, a + dt/FADE_IN) : Math.max(0, a - dt/FADE_OUT);
}

/* The dark disc, then ten cells clockwise from the top. The first `lit` are
   coloured; the rest are dim, so the empty part of the charge stays visible. */
function cells(cx, cy, lit, color){
  const r = RING_R*TILE;
  ctx.fillStyle = DISC;
  ctx.beginPath(); ctx.arc(cx, cy, r + CELL_LW/2 + DISC_PAD, 0, TAU); ctx.fill();
  ctx.lineWidth = CELL_LW;
  for (let i = 0; i < BATT_CELLS; i++){
    const a0 = -Math.PI/2 + i*CELL_SPAN + CELL_TRIM;
    ctx.strokeStyle = i < lit ? color : UNLIT;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + CELL_SPAN - 2*CELL_TRIM);
    ctx.stroke();
  }
}

/* The radar scope in the middle of the ring. `live` is true while the radar is
   on: only then does the scope's line turn and leave its trail. */
function scope(cx, cy, color, live){
  const r = RING_R*TILE;
  const baseAlpha0 = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha0*SCOPE_FADE;
  const reach = (r - CELL_LW/2)*SCOPE_REACH;
  // The scope face: an inner range ring and a crosshair.
  ctx.strokeStyle = SCOPE_FACE;
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(cx, cy, reach/2, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - reach, cy); ctx.lineTo(cx + reach, cy);
  ctx.moveTo(cx, cy - reach); ctx.lineTo(cx, cy + reach);

  if (!live){ ctx.globalAlpha = baseAlpha0; return; }

  /* The trail: wedges behind the line, each fainter than the one before it. */
  ctx.fillStyle = color;
  const band = SCOPE_TRAIL/SCOPE_BANDS;
  const baseAlpha = ctx.globalAlpha;
  for (let i = 0; i < SCOPE_BANDS; i++){
    const a1 = scopeAngle - i*band, a0 = a1 - band;
    ctx.globalAlpha = baseAlpha*0.5*(1 - i/SCOPE_BANDS);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, reach, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha;

  // The line itself.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(scopeAngle)*reach, cy + Math.sin(scopeAngle)*reach);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.globalAlpha = baseAlpha0;
}

/* The percentage, centred inside the ring in the HUD's one tag style: bold
   monospace with a dark outline so it reads over the scope and any floor. */
const LABEL_OUTLINE = 'rgba(12,14,10,0.9)';
function label(text, color, cx, cy){
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 10px "Courier New", Courier, monospace';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = LABEL_OUTLINE;
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
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
  const progress = Math.min(1, Math.max(0, batt/BATT_MAX));
  const color = batt <= BATT_LOW ? DANGER : GREEN;
  /* Rounded up, like the percentage, so only a truly empty battery has no
     lit cell. The epsilon keeps an exact 60 from reading 7 cells. */
  const lit = Math.ceil(progress*BATT_CELLS - 1e-9);
  cells(bx, by, lit, color);
  scope(bx, by, color, radar);
  // Rounded up, so only a truly empty battery reads 0%.
  label(`${Math.ceil(progress*100)}%`, color, bx, by);
  ctx.restore();
}
