import { TILE } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { ctx } from '../canvas.js';
import { TAU } from '../../cast/primitives.js';
import { drawDoor } from '../entities.js';

export function markers(rc){
  const {t} = rc;
  /* ---------- 4. World markers: batteries and the door ---------- */
  for (const b of G.batteries){
    if (b.taken) continue;
    const bx=(b.x+0.5)*TILE, by=(b.y+0.5)*TILE;
    const pu = 0.5 + 0.5*Math.sin(t*0.003);
    // A cylindrical cell seen end-on: pulsing glow, steel can, "+" terminal, a glint that turns
    ctx.fillStyle=`rgba(232,217,138,${0.12+0.14*pu})`;
    ctx.beginPath(); ctx.arc(bx, by, 14, 0, TAU); ctx.fill();
    ctx.strokeStyle=`rgba(232,217,138,${0.4+0.3*pu})`; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(bx, by, 10+pu*1.2, 0, TAU); ctx.stroke();
    ctx.fillStyle='rgba(20,17,8,0.45)';
    ctx.beginPath(); ctx.arc(bx+1.2, by+1.5, 8, 0, TAU); ctx.fill();
    ctx.fillStyle='#b9bdb0'; ctx.strokeStyle='rgba(24,26,16,0.55)';
    ctx.beginPath(); ctx.arc(bx, by, 7.6, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#8f9488';
    ctx.beginPath(); ctx.arc(bx, by, 6, 0, TAU); ctx.fill();
    ctx.fillStyle='#c8d97a';
    ctx.beginPath(); ctx.arc(bx, by, 3.6, 0, TAU); ctx.fill();
    ctx.strokeStyle='#2c2a12'; ctx.lineWidth=1.1;
    ctx.beginPath(); ctx.moveTo(bx-1.8, by); ctx.lineTo(bx+1.8, by); ctx.moveTo(bx, by-1.8); ctx.lineTo(bx, by+1.8); ctx.stroke();
    ctx.strokeStyle='rgba(255,255,235,0.7)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(bx, by, 6.8, t*0.002, t*0.002+1.1); ctx.stroke();
  }

  /* The pipes are not drawn here. They are drawn after the lighting multiply (see
     passes/leaks.js), because they are the one object in the world that the cone
     of vision does not hide. */

  for (const e of G.exitTiles) drawDoor(e, t);
}