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
   ============================================================ */

import { G } from '../../sim/state.js';
import { simAlpha } from './actors.js';
import { ctx, SCALE } from '../canvas.js';
import { NOISE_FULL_SCALE, TILE_SIZE_PX } from '../../config/constants.js';
import { on, EVENT } from '../../util/events.js';
import { drawNoiseGlow, drawNoiseRipple } from '../noise-visuals.js';
import { glowAlpha, glowKick, glowRadius, glowRgb, glowStops, isRedRing, ringAlpha, ringLife, ringRadius, spawnGap } from '../ripple-math.js';

export { GLOW_HOLE, RADIUS_AT_LOUD, glowAlpha, glowKick, glowRadius, glowRgb, glowStops, isRedRing, maxRadius, ringAlpha, ringLife, ringRadius, spawnGap } from '../ripple-math.js';

/* Below this noise nothing is drawn or spawned. Same gate as the old ring, so
   the HUD appears at the same moments it always did. */
export const NOISE_FLOOR = 0.02;

/* Hard cap on live rings. Only a few are ever alive at once (a ring lives
   about a second), so this only matters if the timer is ever wrong. */
export const MAX_RINGS = 24;

/* Seconds for the glow to fade in and out. Quick in, so it is there when the
   sound is; slower out, so it does not flicker between footsteps. */
const FADE_IN = 0.15;
const FADE_OUT = 0.4;

/* The glow follows the noise level through this ease, in seconds, so the 60 Hz
   simulation values do not make it flicker. */
const LEVEL_EASE = 0.1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
on(EVENT.floorBuilt, resetRipples);

/* Draws the glow around the plumber at (x, y), in world pixels. */
function glow(x, y){
  const R = glowRadius(level)*TILE_SIZE_PX;
  const [r, g, b] = glowRgb(level*NOISE_FULL_SCALE);
  const kick = glowKick(gapT);
  drawNoiseGlow(ctx, x, y, R, [r, g, b], presence*glowAlpha(level, kick), glowStops(glowRadius(level)));
}

/* Draws one ring around the plumber at (x, y): a dark outline under a coloured
   stroke, so it reads on carpet and on the dark. The ring is centred on the
   plumber as they are now, not where the ring was made. */
function drawRing(r, x, y){
  const radius = ringRadius(r.n, r.age);
  drawNoiseRipple(ctx, x, y, radius*TILE_SIZE_PX, ringAlpha(r.n, r.age), r.age, ringLife(r.n), isRedRing(radius));
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
  level += (clamp(noise/NOISE_FULL_SCALE, 0, 1) - level)*(1 - Math.exp(-dt/LEVEL_EASE));

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
    gapT = spawnGap(0);
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
  if (presence > 0) glow(px*TILE_SIZE_PX, py*TILE_SIZE_PX);
  for (const r of rings) drawRing(r, px*TILE_SIZE_PX, py*TILE_SIZE_PX);
  ctx.restore();
}
