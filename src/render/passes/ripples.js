/* ============================================================
   FLOOR RIPPLES
   The noise indicator. While the plumber is making noise, a ring spreads out
   from their feet every 0.26 to 0.5 s. A ring stays where it was made, so the
   trail of them shows where the plumber has been loud. Size and speed follow
   the noise level, so a wade, a walk and a sprint look different with no words.

   The reference circle at LOUD tells you where the threshold is. A ring that
   grows past it turns red, because it has crossed into the range that wakes
   sleepers and starts hunts.

   Render-only. It reads G.selfNoise and the plumber's drawn position and writes
   nothing back to the simulation. It is drawn after post() (see render.js), so
   the light bake, the radar tint and the CRT never touch it, and it reads in
   the dark. Rings are cleared on every new floor.

   The maths is in plain functions at the top so the tests can check the
   numbers without a canvas.
   ============================================================ */

import { G } from '../../sim/state.js';
import { simAlpha } from './actors.js';
import { ctx, SCALE } from '../canvas.js';
import { TAU } from '../../cast/primitives.js';
import { LOUD, NOISE_FS, TILE } from '../../config/constants.js';
import { on } from '../../util/events.js';

/* Below this noise nothing is drawn or spawned. Same gate as the old ring, so
   the HUD appears at the same moments it always did. */
export const NOISE_FLOOR = 0.02;

/* How far a ring reaches at the LOUD threshold, in tiles. Chosen so the
   reference circle is a sensible size on screen. Every other noise level scales
   from here in proportion, so a sprint (0.70) reaches 2.1 tiles, the wrench
   (0.85) 2.55 and a walk (0.20) 0.6. The radius is a symbol for loudness, not
   the real hearing range, which is in sim/noise.js. */
export const RADIUS_AT_LOUD = 1.5;
/* The smallest a ring starts, in tiles, so it appears as a dot and not a point. */
const R_START = 0.15;

/* Spawn gap at the quiet end and the loud end, in seconds. A walk is 0.2 and
   gets the slow gap; anything at or above 0.44 gets the fast one. */
const GAP_QUIET = 0.5;
const GAP_LOUD = 0.26;
const GAP_RAMP_FROM = 0.2;
const GAP_RAMP_SPAN = 0.5;

/* Hard cap on live rings. Only a few are ever alive at once (a ring lives
   about a second), so this only matters if the timer is ever wrong. */
export const MAX_RINGS = 24;

/* Colours. The amber is the palette's bright yellow; the red is the danger
   colour shared with the rest of the HUD. */
const AMBER = '#e4e6a8';
const DANGER = '#d8503c';
const OUTLINE = '#0c0e0a';
const REF = '#2a2810';
const HUD_OPACITY = 0.8;
const REF_ALPHA = 0.4;     // the LOUD circle sits at this share of the HUD opacity
/* Seconds for the reference circle to fade in and out, matching the old ring. */
const FADE_IN = 0.15;
const FADE_OUT = 0.4;
/* How many dashes make up the dotted reference circle. Canvas setLineDash is
   not used, so the test stub can record every dash as a plain arc. */
const DASHES = 36;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Seconds between spawns at this noise. Louder noise spawns faster. */
export function spawnGap(noise){
  return GAP_QUIET - (GAP_QUIET - GAP_LOUD)*clamp((noise - GAP_RAMP_FROM)/GAP_RAMP_SPAN, 0, 1);
}

/* How far a ring of this noise reaches at the end of its life, in tiles. */
export function maxRadius(noise){
  return RADIUS_AT_LOUD*noise/LOUD;
}

/* How long a ring of this noise lives, in seconds. Louder rings last less time,
   so a sprint's trail clears quicker than a walk's. */
export function ringLife(noise){
  return 1.1 - 0.5*clamp(noise/NOISE_FS, 0, 1);
}

/* A ring's radius in tiles at `age` seconds. It grows fast then slows, so it
   looks like a splash rather than a steady expansion. */
export function ringRadius(noise, age){
  const k = clamp(age/ringLife(noise), 0, 1);
  const grow = 1 - Math.pow(1 - k, 2.2);
  return R_START + (maxRadius(noise) - R_START)*grow;
}

/* A ring's opacity at `age`, 0 to 1 before the HUD's own 80%. It scales with
   the noise that made it, so a faint step leaves a faint ring. */
export function ringAlpha(noise, age){
  const k = clamp(age/ringLife(noise), 0, 1);
  return Math.pow(1 - k, 1.3)*clamp(noise/NOISE_FS, 0, 1);
}

/* A ring is red once it has grown past the LOUD circle. */
export function isRedRing(radiusTiles){
  return radiusTiles >= RADIUS_AT_LOUD;
}

/* Moves the presence value toward its target at the fade speed. */
function fade(a, on, dt){
  return on ? Math.min(1, a + dt/FADE_IN) : Math.max(0, a - dt/FADE_OUT);
}

/* The live rings and the timer state. Render-only. */
let rings = [];
let gapT = 0;
let presence = 0;

/* How many rings are alive. The tests read this; nothing in the game does. */
export function liveRingCount(){
  return rings.length;
}

/* Forgets every ring. Called when a new floor is built, so the old floor's
   trail never shows up over the new one. */
export function resetRipples(){
  rings = [];
  gapT = 0;
  presence = 0;
}
on('floorBuilt', resetRipples);

/* Draws the dotted LOUD circle around the plumber. */
function loudCircle(x, y){
  const R = RADIUS_AT_LOUD*TILE;
  const a = presence*HUD_OPACITY*REF_ALPHA;
  ctx.strokeStyle = REF;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = a;
  const seg = TAU/DASHES;
  for (let i = 0; i < DASHES; i += 2){
    const a0 = i*seg;
    ctx.beginPath(); ctx.arc(x, y, R, a0, a0 + seg*0.6); ctx.stroke();
  }
}

/* Draws one ring: a dark outline under a coloured stroke, so it reads on
   carpet and on the dark. */
function drawRing(r){
  const a = ringAlpha(r.n, r.age)*HUD_OPACITY;
  if (a < 0.004) return;
  const rad = ringRadius(r.n, r.age);
  const k = clamp(r.age/ringLife(r.n), 0, 1);
  const w = 2.4*(1 - 0.5*k);
  const x = r.x*TILE, y = r.y*TILE;
  ctx.beginPath(); ctx.arc(x, y, rad*TILE, 0, TAU);
  ctx.globalAlpha = a*0.55; ctx.strokeStyle = OUTLINE; ctx.lineWidth = w + 2; ctx.stroke();
  ctx.globalAlpha = a; ctx.strokeStyle = isRedRing(rad) ? DANGER : AMBER; ctx.lineWidth = w; ctx.stroke();
}

/**
 * Spawns, ages and draws the floor ripples. Called once per frame from render(),
 * inside the frame, after post() and before the battery ring.
 *
 * @param {object} rc - the render frame context.
 */
export function ripples(rc){
  const {p} = rc;
  if (!p) return;

  const noise = G.selfNoise || 0;
  const dt = rc.dt;
  presence = fade(presence, noise > NOISE_FLOOR, dt);

  /* The same smoothed position the battery ring uses, so rings start under the
     figure you see and not one tick behind it. */
  const px = p.px + (p.x - p.px)*simAlpha;
  const py = p.py + (p.y - p.py)*simAlpha;

  if (noise > NOISE_FLOOR){
    gapT += dt;
    if (gapT >= spawnGap(noise)){
      gapT = 0;
      rings.push({x: px, y: py, n: noise, age: 0});
      if (rings.length > MAX_RINGS) rings.shift();
    }
  } else {
    /* Silent: the next noise spawns a ring on its first frame. */
    gapT = GAP_QUIET;
  }

  for (const r of rings) r.age += dt;
  for (let i = rings.length - 1; i >= 0; i--){
    if (rings[i].age >= ringLife(rings[i].n)) rings.splice(i, 1);
  }

  if (presence <= 0 && rings.length === 0) return;

  ctx.save();
  /* The pass runs after post(), which leaves the context in device space, so
     the world transform is set up here, and only when something is drawn. */
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.translate(rc.tx, rc.ty);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round';
  if (presence > 0) loudCircle(px*TILE, py*TILE);
  for (const r of rings) drawRing(r);
  ctx.restore();
}
