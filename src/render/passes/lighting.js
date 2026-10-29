import { MAP_H, MAP_W, TILE } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { ctx, SCALE } from '../canvas.js';

export function lighting(rc){
  const {dx, dy} = rc;
  /* ---------- 6. Lighting ---------- */
  ctx.setTransform(1,0,0,1,0,0);

  // The ambient bake (multiply): mono-yellow, and only where the character can see
  ctx.globalCompositeOperation='multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(G.lightCv, dx, dy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);

  /* The visibility mask: room scope x distance x cone, or everything at once while
     the radar sweeps. It is a multiply, so it can only REMOVE light that the bake
     put there. That is the point of it. */
  ctx.drawImage(G.maskCv, dx, dy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);

  /* The radar reveals the whole floor, so while it is on the frame is tinted the
     classic green-phosphor radar instead of the warm yellow the palette uses
     everywhere else. It is a multiply over the map and not a second mask: the mask
     already owns brightness, and this only shifts the revealed palette's hue. */
  if (G.radar){
    ctx.globalCompositeOperation='multiply';
    ctx.fillStyle='rgb(14, 83, 18)';
    ctx.fillRect(dx, dy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);
  }

  ctx.globalCompositeOperation='source-over';
}