/* ============================================================
   RENDER
   This file owns the camera, clears the frame, and runs the passes in order.
   Each pass gets the same frame context `rc`:

     ground    carpet, the flood and its shine, the walls
     markers   batteries and the door
     actors    the player and lifeforms, sorted by y, at their smoothed position
     lighting  the light bake, the visibility mask, the ceiling lights
     leaks     the pipes (not hidden by the cone)
     post      the danger wash, the vignette and the tape effects

   The first three draw INSIDE the world transform that render() opens and
   closes. The last three draw in device space, after it has been restored. That
   boundary is why the passes are in this order.
   ============================================================ */

import { MAP_H, MAP_W, TILE } from '../config/constants.js';
import { G } from '../sim/state.js';
import { cvs, ctx, SCALE } from './canvas.js';
import { actors } from './passes/actors.js';
import { ground } from './passes/ground.js';
import { leaks } from './passes/leaks.js';
import { lighting } from './passes/lighting.js';
import { markers } from './passes/markers.js';
import { particles } from './passes/particles.js';
import { post } from './passes/post.js';
import { syncImages } from './pack.js';

/* ---------- Camera ----------
   One mapping is used everywhere:
      device_px = SCALE * (world_tiles*TILE + tx)
   so the player's tile is always at the centre of the viewport, and the light
   bake (which shares the same origin) lines up with the geometry. */
export const cam = {x:0, y:0, jx:0, jy:0};

export { setSimAlpha } from './passes/actors.js';

/**
 * Draws one frame.
 *
 * @param {number} t - the browser's frame timestamp in milliseconds.
 */
export function render(t){
  if (!G) return;
  syncImages();
  const p=G.plumber;

  /* The camera eases toward the player with a time constant against the wall
     clock, so it feels the same at any frame rate. A fixed fraction per frame
     would be twice as fast at 144 fps as at 72 fps. This is correct because the
     world now advances on its own fixed clock: the camera is easing toward a
     position the simulation owns. */
  const dt   = Math.max(0.001, Math.min(0.1, (t - (render.prevT || t-16))/1000));
  render.prevT = t;
  /* The seconds since the last frame, for effects that must happen at the same
     rate per second on every machine (the tube and tape dropouts).

     It is clamped to a quarter of a second. A tab returning from the
     background arrives with a delta of tens of seconds, and the dropout loops
     run once per 50 ms of it, so one frame after a long pause would issue
     thousands of draws. Nobody saw the frames they missed, so catching up on
     them is wasted work. */
  render.dt = Math.min(0.25, Math.max(0, (t - (render.prevTRaw ?? (t-16)))/1000));
  render.prevTRaw = t;
  const k    = 1 - Math.exp(-dt/0.09);
  cam.x += (p.x - cam.x) * k;
  cam.y += (p.y - cam.y) * k;
  const breathe = Math.sin(t*0.0009)*0.06;
  /* Camera jitter: a slow breathing sway plus a handheld wobble. It is always
     on, since it is part of how the game looks.

     The random wobble is scaled by the square root of the frame time. It is a
     fresh random value every frame, so at 30 fps it would give twice the
     movement per second that 60 fps does, and the wobble would be livelier on a
     slow machine. This keeps the per-second feel the same at any refresh rate. */
  const jscale = Math.sqrt(dt/0.0167);
  cam.jx = (Math.random()-0.5)*0.10*jscale + breathe*0.35;
  cam.jy = (Math.random()-0.5)*0.10*jscale;

  // Clamp to the map, so the viewport never shows empty space beyond the edge
  const T = TILE*SCALE;
  const halfW = cvs.width /(2*T), halfH = cvs.height/(2*T);
  if (MAP_W > halfW*2) cam.x = Math.max(halfW, Math.min(MAP_W-halfW, cam.x));
  if (MAP_H > halfH*2) cam.y = Math.max(halfH, Math.min(MAP_H-halfH, cam.y));

  // The translation applied inside the scaled context, in world pixels
  const tx = -cam.x*TILE + cvs.width /(2*SCALE) + cam.jx;
  const ty = -cam.y*TILE + cvs.height/(2*SCALE) + cam.jy;
  // The same mapping, in device pixels
  const dx = tx*SCALE, dy = ty*SCALE;
  const w2sx = wx => SCALE*(wx*TILE + tx);
  const w2sy = wy => SCALE*(wy*TILE + ty);

  /* Clear the frame. Without this, anything the scene does not paint (the
     margin beyond the map edge) would keep last frame's pixels and the
     post-processing would pile up on top of it. */
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='#000';
  ctx.fillRect(0,0,cvs.width,cvs.height);

  ctx.setTransform(SCALE,0,0,SCALE,0,0);
  ctx.save();
  ctx.translate(tx, ty);

  // The visible tile range (with a margin), so the passes only draw what is on screen
  const tlx = Math.floor(cam.x - cvs.width /(2*T)) - 1;
  const tly = Math.floor(cam.y - cvs.height/(2*T)) - 1;
  const tw  = Math.ceil(cvs.width /T) + 3;
  const th  = Math.ceil(cvs.height/T) + 3;

  const x0=Math.max(0,tlx), y0=Math.max(0,tly);
  const x1=Math.min(MAP_W-1,tlx+tw), y1=Math.min(MAP_H-1,tly+th);
  const vw = x1-x0+1, vh = y1-y0+1;

  const rc = { t, dt:render.dt, tx, ty, dx, dy, x0, y0, x1, y1, vw, vh, T, w2sx, w2sy, p };

  ground(rc);
  markers(rc);
  actors(rc);
  particles(rc);
  ctx.restore();

  lighting(rc);
  leaks(rc);
  post(rc);
}