/* ============================================================
   RENDER
   Clears the frame, opens the world transform, runs the world-space passes,
   restores, runs the device-space passes. Camera, viewport and mapping live
   in frame.js; each pass takes the rc that buildFrame returns.
   ============================================================ */

import { G } from '../sim/state.js';
import { cvs, ctx, SCALE } from './canvas.js';
import { buildFrame } from './frame.js';
import { actors } from './passes/actors.js';
import { ground } from './passes/ground.js';
import { leaks, puddles, repairRing } from './passes/leaks.js';
import { lighting } from './passes/lighting.js';
import { markers } from './passes/markers.js';
import { particles } from './passes/particles.js';
import { diegetic } from './passes/diegetic.js';
import { ripples } from './passes/ripples.js';
import { post } from './passes/post.js';
import { doorCrank } from './entities.js';
import { syncSurfaces } from './floor-surfaces.js';

export { setSimAlpha } from './passes/actors.js';
export { cam } from './frame.js';

/**
 * Draws one frame.
 *
 * @param {number} t - the browser's frame timestamp in milliseconds.
 */
export function render(t){
  if (!G) return;
  syncSurfaces(G);

  const rc = buildFrame(t);

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
  ctx.translate(rc.tx, rc.ty);

  ground(rc);
  markers(rc);
  puddles(rc);
  actors(rc);
  particles(rc);
  ctx.restore();

  lighting(rc);
  leaks(rc);
  post(rc);

  /* The world rings (repair, door crank), the floor ripples and the battery
     ring are drawn after post() so the light bake, the radar's green tint and
     the VHS pass never touch them: they stay readable in the dark and while the
     radar is on. */
  repairRing(rc);
  ctx.save();
  ctx.setTransform(SCALE,0,0,SCALE,0,0);
  ctx.translate(rc.tx, rc.ty);
  for (const e of G.exitTiles) doorCrank(e, t);
  ctx.restore();
  ripples(rc);
  diegetic(rc);
}
