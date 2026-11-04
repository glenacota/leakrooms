import { TILE } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { ctx } from '../canvas.js';
import { drawDoor } from '../entities.js';

const RIM = 'rgba(24,26,16,.55)';
const LIGHT = { x: -.55, y: -.55 };

function batteryShadow(rx, ry, len, alpha){
  ctx.fillStyle=`rgba(8,6,3,${alpha})`;
  ctx.beginPath();
  for (let i=0; i<=5; i++){
    const u=i/5;
    ctx.moveTo(-LIGHT.x*len*u+rx, -LIGHT.y*len*u);
    ctx.ellipse(-LIGHT.x*len*u, -LIGHT.y*len*u, rx*(1-.3*u), ry*(1-.3*u), 0, 0, Math.PI*2);
  }
  ctx.fill();
}

function drawBattery(t){
  const pulse=.5+.5*Math.sin(t*3);
  const hover=.5+.5*Math.sin(t*2.4);
  ctx.save();
  ctx.rotate(Math.sin(t*.8)*.35);

  ctx.fillStyle=`rgba(232,217,138,${.3+.2*pulse})`;
  ctx.beginPath(); ctx.arc(0,0,17,0,Math.PI*2); ctx.fill();

  batteryShadow(8,10,3+hover*3,.3-hover*.08);

  ctx.strokeStyle=`rgba(232,217,138,${.5+.3*pulse})`;
  ctx.lineWidth=1;
  ctx.beginPath(); ctx.roundRect(-11,-13.5,22,27,5); ctx.stroke();

  ctx.fillStyle='#c8d97a'; ctx.strokeStyle=RIM;
  ctx.beginPath(); ctx.roundRect(-8.5,-11,17,22,3); ctx.fill(); ctx.stroke();

  ctx.fillStyle='#d9dcc0';
  ctx.fillRect(-2.4,-13.4,4.8,2.6);

  ctx.fillStyle='#2c2a12';
  ctx.fillRect(-6,-7.5,12,15);

  const charge=Math.floor((t*1.2)%5);
  for (let i=0; i<4; i++){
    ctx.fillStyle=i<charge ? (i<1 ? '#e8704a' : '#9fe870') : '#3c4a2c';
    ctx.fillRect(-4.6,4.8-i*3.6,9.2,2.4);
  }
  ctx.restore();
}

export function markers(rc){
  const t=rc.t*0.001;
  /* ---------- 4. World markers: batteries and the door ---------- */
  for (const b of G.batteries){
    if (b.taken) continue;
    // Batteries are stored at the tile centre already, unlike the door's tile index.
    const bx=b.x*TILE, by=b.y*TILE;
    ctx.save();
    ctx.translate(bx,by);
    ctx.scale(0.6,0.6);
    drawBattery(t);
    ctx.restore();
  }

  /* The leaks are not drawn here. They are drawn after the lighting multiply (see
     passes/leaks.js), because they are the one object in the world that the cone
     of vision does not hide. */

  for (const e of G.exitTiles) drawDoor(e, rc.t);
}