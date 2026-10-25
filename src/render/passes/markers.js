import { TILE } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { ctx } from '../canvas.js';
import { drawDoor } from '../entities.js';

export function markers(rc){
  const {t} = rc;
  /* ---------- 4. World markers: batteries and the door ---------- */
  for (const b of G.batteries){
    if (b.taken) continue;
    const bx=(b.x+0.5)*TILE, by=(b.y+0.5)*TILE;
    const pu = 1 + Math.sin(t*0.004)*0.12;
    ctx.fillStyle='rgba(20,17,8,0.45)'; ctx.fillRect(bx-9, by-11, 18, 22);
    ctx.fillStyle='#c8d97a'; ctx.fillRect(bx-7, by-9, 14, 18);
    ctx.fillStyle='#2c2a12'; ctx.fillRect(bx-5, by-7, 10, 5*pu+3);
    ctx.strokeStyle='rgba(232,217,138,0.5)'; ctx.lineWidth=1;
    ctx.strokeRect(bx-7.5, by-9.5, 15, 19);
  }

  /* The pipes are not drawn here. They are drawn after the lighting multiply (see
     passes/leaks.js), because they are the one object in the world that the cone
     of vision does not hide. */

  for (const e of G.exitTiles) drawDoor(e, t);
}