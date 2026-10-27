/* ============================================================
   PARTICLES
   Pure visuals: water drips from burst pipes and splashes when
   the plumber wades. The simulation only emits 'particle' events;
   this pass spawns, ages and draws them. Nothing here touches
   the simulation, so it can live in the render layer.

   Each particle: position (world tiles), velocity (tiles/s),
   life (seconds), size (device px) and a colour that fades out
   as life drains. Drawn as 1-2 px dots inside the camera
   transform, so the lighting/visibility mask still dims them in
   the dark.
   ============================================================ */

import { on } from '../../util/events.js';
import { ctx, SCALE } from '../canvas.js';
import { TILE } from '../../config/constants.js';

const pool = [];
const MAX_PARTICLES = 200; // hard cap: visuals never cost more than a few hundred dots

/* Spawn a drip falling from a burst pipe, or a splash from a wading step. */
on('particle', (kind, x, y)=>{
  if (kind === 'drip'){
    pool.push({
      x: x + (Math.random()-0.5)*0.10,
      y: y,
      vx: (Math.random()-0.5)*0.5,
      vy: 0.8 + Math.random()*1.0,     // tiles/s, +y is down on screen
      gravity: 5,                       // tiles/s^2
      life: 0.35 + Math.random()*0.30,
      maxLife: 1,
      size: 1 + Math.random(),          // device px
      color: 'rgba(170,216,224,',
    });
  } else if (kind === 'splash'){
    const count = 5 + Math.floor(Math.random()*5);
    for (let i = 0; i < count; i++){
      const ang = Math.random()*6.2831;
      const sp  = 1.0 + Math.random()*2.0;
      pool.push({
        x: x + (Math.random()-0.5)*0.20,
        y: y + (Math.random()-0.5)*0.20,
        vx: Math.cos(ang)*sp,
        vy: Math.sin(ang)*sp - 1.0,
        gravity: 6,
        life: 0.30 + Math.random()*0.50,
        maxLife: 1,
        size: 1 + Math.random()*1.5,
        color: 'rgba(210,235,245,',
      });
    }
  }
  while (pool.length > MAX_PARTICLES) pool.shift();
});

/**
 * Age every live particle by `dt` seconds and remove the dead ones.
 * Called once per rendered frame.
 *
 * @param {number} dt - seconds since the last frame.
 */
export function tickParticles(dt){
  for (let i = pool.length-1; i >= 0; i--){
    const p = pool[i];
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    p.vy += p.gravity * dt;
    p.life -= dt;
    if (p.life <= 0) pool.splice(i, 1);
  }
}

/**
 * Draw the live particles as 1-2 px dots, in world space.
 * Call inside the camera transform (before ctx.restore()).
 *
 * @param {object} rc - the render frame context (x0..x1 tile viewport for culling)
 */
export function drawParticles(rc){
  const {x0, y0, x1, y1} = rc;
  const rscale = 1/SCALE;             // device px -> world px
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of pool){
    const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
    if (alpha <= 0) continue;
    // cull off-screen tiles
    if (p.x < x0-1 || p.x > x1+1 || p.y < y0-1 || p.y > y1+1) continue;
    ctx.fillStyle = p.color + (alpha*0.9 + 0.05) + ')';
    const r = p.size * rscale;
    ctx.beginPath();
    ctx.arc(p.x*TILE, p.y*TILE, r, 0, 6.2831);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * One render-frame pass: age the particles, then draw them.
 * Placed inside the world transform, after the actors.
 *
 * @param {object} rc - the render frame context
 */
export function particles(rc){
  tickParticles(rc.dt);
  drawParticles(rc);
}
