/* ============================================================
   DIEGETIC HUD
   A radar ring pinned to the right of the plumber, instead of a corner gauge.
   It fades in when it has something to say and fades out when it does not.

     battery — right, a radar scope. Shows while the radar is on, or right
               after a battery pickup. Green, red when low.

   The ring sits on a dark disc so it stays readable over a bright floor. Its
   glyph says what it is, so nobody has to learn the colours. It is drawn with
   canvas paths (the game has no image assets).

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
import { TILE, BATT_MAX, BATT_LOW } from '../../config/constants.js';

/* How far above the plumber's centre the battery ring sits, in tiles. It is
   lower than the ripples' origin, so the two never overlap. */
const BATT_Y = -0.3;
/* How far the ring sits to the right of the plumber's centre, in tiles. The
   plumber's collision radius is 0.33, so the ring edge (0.8 - 0.30) clears the
   body. */
const SIDE = 0.8;
/* Ring radius, in tiles. */
const RING_R = 0.30;
/* Track and sweep thickness, in world pixels. */
const TRACK_LW = 3;
const SWEEP_LW = 2.5;
/* The dark disc behind the ring reaches this many pixels past the track. */
const DISC_PAD = 2;
/* Seconds for the ring to fade in and out. Quick in, so the ring is there when
   the radar is; slower out, so it does not flicker. */
const FADE_IN = 0.15;
const FADE_OUT = 0.4;

const DANGER = '#d8503c';
const GREEN  = '#8fd07a';  // same green as the door crank: charged
const TRACK  = 'rgba(20,24,18,0.6)';
const DISC   = 'rgba(12,14,10,0.7)';
const SCOPE_FACE = 'rgba(143,208,122,0.35)';
/* The diegetic HUD (rings, discs, sweeps, glyphs, scope, tags) runs at 90%
   opacity so it reads without fighting the floor brightness behind it. */
const HUD_OPACITY = 0.8;

/* How visible the battery ring is, 0 to 1. Render-only. */
let battAlpha = 0;

/* The radar scope inside the battery ring: a line that turns once every
   SCOPE_TURN seconds, dragging a fading trail SCOPE_TRAIL radians long behind
   it, like a radar screen. It only turns while the radar is on, so it shows the
   radar is live; with the radar off (right after a battery pickup) the scope is
   just its faint rings and crosshair. */
const SCOPE_TURN = 1.4;
const SCOPE_TRAIL = 1.2;
const SCOPE_BANDS = 10;
/* How far the scope reaches, as a share of the ring's inner radius. */
const SCOPE_REACH = 0.9;
let scopeAngle = 0;

// Moves a fade value toward its target at the fade-in or fade-out speed.
function fade(a, on, dt){
  return on ? Math.min(1, a + dt/FADE_IN) : Math.max(0, a - dt/FADE_OUT);
}

// The dark disc and the faint full track that the ring starts with.
function base(cx, cy){
  const r = RING_R*TILE;
  ctx.fillStyle = DISC;
  ctx.beginPath(); ctx.arc(cx, cy, r + DISC_PAD, 0, TAU); ctx.fill();
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = TRACK_LW;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
}

/* The battery ring: a clockwise sweep from the top that fills as `progress`
   goes 0 -> 1, with a radar scope in the middle. `live` is true while the radar
   is on: only then does the scope's line turn and leave its trail. */
function batteryRing(cx, cy, progress, color, live){
  const r = RING_R*TILE;
  base(cx, cy);
  if (progress > 0.01){
    ctx.strokeStyle = color;
    ctx.lineWidth = SWEEP_LW;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + progress*TAU);
    ctx.stroke();
  }

  const reach = (r - TRACK_LW/2)*SCOPE_REACH;
  // The scope face: an inner range ring and a crosshair.
  ctx.strokeStyle = SCOPE_FACE;
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(cx, cy, reach/2, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - reach, cy); ctx.lineTo(cx + reach, cy);
  ctx.moveTo(cx, cy - reach); ctx.lineTo(cx, cy + reach);

  if (!live) return;

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
}

/* A label above the ring, in the HUD's one tag style: bold 9px monospace,
   centred, TAG_GAP px over the ring's edge. A dark outline under the text keeps
   it readable on any floor, like the dark disc behind the ring. `alpha`
   multiplies the ring's own fade. */
const TAG_GAP = 7;
const TAG_OUTLINE = 'rgba(12,14,10,0.85)';
function tag(text, color, alpha, cx, cy){
  if (alpha <= 0) return;
  const y = cy - RING_R*TILE - TAG_GAP;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = 'bold 9px "Courier New", Courier, monospace';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1;
  ctx.strokeStyle = TAG_OUTLINE;
  ctx.strokeText(text, cx, y);
  ctx.fillStyle = color;
  ctx.fillText(text, cx, y);
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
  const color = batt < BATT_LOW ? DANGER : GREEN;
  batteryRing(bx, by, progress, color, radar);
  // Rounded up, so only a truly empty battery reads 0%.
  tag(`${Math.ceil(progress*100)}%`, color, 1, bx, by);
  ctx.restore();
}
