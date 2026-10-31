/* ============================================================
   FLOOR RIPPLES AND GLOW
   The noise indicator. It has two parts, both centred on the plumber's feet
   and both travelling with them, so nothing is left behind on the floor.

   The glow is a soft ring of light around the body. It grows and brightens with
   the noise level, flashes a little as each ripple leaves, and shifts from
   yellow to red as the noise passes LOUD. Its middle is clear, so it never
   washes out the plumber's suit.

   The ripples are rings that spread out from the glow every 0.5 to 0.65 s. Size
   and speed follow the noise level, so a wade, a walk and a sprint look
   different with no words. A ring that grows past 1.5 tiles turns red, because
   that is the range that wakes sleepers and starts hunts. Nothing marks that
   radius on screen: the colour change is the signal.

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
const GAP_QUIET = 0.75;
const GAP_LOUD = 0.5;
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
const HUD_OPACITY = 0.8;
/* Seconds for the glow to fade in and out. Quick in, so it is there when the
   sound is; slower out, so it does not flicker between footsteps. */
const FADE_IN = 0.15;
const FADE_OUT = 0.4;

/* The glow's size in tiles: a base that is always there plus a gain at full
   noise. Small on purpose, so the rings carry the size and the glow carries the
   level. */
const GLOW_R_BASE = 0.42;
const GLOW_R_GAIN = 0.5;
/* Inside this radius, in tiles, the glow is clear. The plumber's suit and hood
   reach about 0.2 tiles from the centre, and a bright wash over a yellow suit
   hides the thing the player is watching. */
export const GLOW_HOLE = 0.1;
/* The glow goes from pale yellow to the danger red over this noise range, which
   straddles LOUD (0.5) so the change is under way as the noise crosses it. */
const GLOW_YELLOW = [255, 245, 160];
const GLOW_RED = [216, 80, 60];
const GLOW_RED_FROM = 0.44;
const GLOW_RED_TO = 0.54;
/* Seconds the glow takes to flash after a ripple spawns, and how far the flash
   swings either side of the steady brightness (a 0.8 to 1.2 multiplier). */
const KICK_TIME = 0.25;
const KICK_LOW = 0.8;
const KICK_SPAN = 0.4;
/* The glow follows the noise level through this ease, in seconds, so the 60 Hz
   simulation values do not make it flicker. */
const LEVEL_EASE = 0.1;

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

const smooth = (a, b, v) => {
  const t = clamp((v - a)/(b - a), 0, 1);
  return t*t*(3 - 2*t);
};

/* The glow's outer radius in tiles at this level (noise / NOISE_FS, 0 to 1). */
export function glowRadius(level){
  return GLOW_R_BASE + GLOW_R_GAIN*clamp(level, 0, 1);
}

/* The glow's colour as [r, g, b] at this noise: yellow while quiet, red once
   the noise is past LOUD, a blend in between. */
export function glowRgb(noise){
  const k = smooth(GLOW_RED_FROM, GLOW_RED_TO, noise);
  return GLOW_YELLOW.map((y, i) => Math.round(y + (GLOW_RED[i] - y)*k));
}

/* The glow's opacity before the HUD's own 80%. It scales with the level, so a
   quiet step is a faint glow. `kick` is 1 as a ripple spawns and falls to 0, so
   the glow pulses once per ring. */
export function glowAlpha(level, kick){
  return clamp(clamp(level, 0, 1)*(KICK_LOW + KICK_SPAN*clamp(kick, 0, 1)), 0, 1);
}

/* How strong the flash is `sinceSpawn` seconds after a ring left: 1, then 0. */
export function glowKick(sinceSpawn){
  return clamp(1 - sinceSpawn/KICK_TIME, 0, 1);
}

/* The glow's colour stops as [offset, alpha] pairs from the centre to the edge
   of a glow `radiusTiles` wide. Clear up to GLOW_HOLE, then a bright rim that
   fades out. */
export function glowStops(radiusTiles){
  const hole = clamp(GLOW_HOLE/radiusTiles, 0, 0.95);
  const span = 1 - hole;
  return [[0, 0], [hole, 0], [hole + span*0.25, 0.95], [hole + span*0.6, 0.45], [1, 0]];
}

/* Moves the presence value toward its target at the fade speed. */
function fade(a, on, dt){
  return on ? Math.min(1, a + dt/FADE_IN) : Math.max(0, a - dt/FADE_OUT);
}

/* The live rings and the timer state. Render-only. */
let rings = [];
let gapT = 0;
let presence = 0;
let level = 0;       // the eased noise level, 0 to 1

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
  level = 0;
}
on('floorBuilt', resetRipples);

/* Draws the glow around the plumber at (x, y), in world pixels. */
function glow(x, y){
  const R = glowRadius(level)*TILE;
  const [r, g, b] = glowRgb(level*NOISE_FS);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
  for (const [at, a] of glowStops(glowRadius(level))) grad.addColorStop(at, `rgba(${r},${g},${b},${a})`);
  const kick = glowKick(gapT);
  ctx.globalAlpha = Math.min(1, presence*HUD_OPACITY*glowAlpha(level, kick));
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
}

/* Draws one ring around the plumber at (x, y): a dark outline under a coloured
   stroke, so it reads on carpet and on the dark. The ring is centred on the
   plumber as they are now, not where the ring was made. */
function drawRing(r, x, y){
  const a = ringAlpha(r.n, r.age)*HUD_OPACITY;
  if (a < 0.004) return;
  const rad = ringRadius(r.n, r.age);
  const k = clamp(r.age/ringLife(r.n), 0, 1);
  const w = 2.4*(1 - 0.5*k);
  ctx.beginPath(); ctx.arc(x, y, rad*TILE, 0, TAU);
  ctx.globalAlpha = a*0.55; ctx.strokeStyle = OUTLINE; ctx.lineWidth = w + 2; ctx.stroke();
  ctx.globalAlpha = a; ctx.strokeStyle = isRedRing(rad) ? DANGER : AMBER; ctx.lineWidth = w; ctx.stroke();
}

/**
 * Spawns, ages and draws the glow and the floor ripples. Called once per frame
 * from render(), inside the frame, after post() and before the battery ring.
 *
 * @param {object} rc - the render frame context.
 */
export function ripples(rc){
  const {p} = rc;
  if (!p) return;

  const noise = G.selfNoise || 0;
  const dt = rc.dt;
  presence = fade(presence, noise > NOISE_FLOOR, dt);
  level += (clamp(noise/NOISE_FS, 0, 1) - level)*(1 - Math.exp(-dt/LEVEL_EASE));

  /* The same smoothed position the battery ring uses, so the glow and rings sit
     under the figure you see and not one tick behind it. */
  const px = p.px + (p.x - p.px)*simAlpha;
  const py = p.py + (p.y - p.py)*simAlpha;

  if (noise > NOISE_FLOOR){
    gapT += dt;
    if (gapT >= spawnGap(noise)){
      gapT = 0;
      rings.push({n: noise, age: 0});
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
  if (presence > 0) glow(px*TILE, py*TILE);
  for (const r of rings) drawRing(r, px*TILE, py*TILE);
  ctx.restore();
}
