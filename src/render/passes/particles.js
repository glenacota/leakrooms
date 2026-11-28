/* ============================================================
   PARTICLES
   Pure visuals: water drips from burst pipes and splashes when
   the plumber wades. The simulation emits semantic events; this
   pass spawns, ages and draws them. Repair sparks are redrawn above
   post-processing so the repair cue stays legible in dark areas.

   Each particle: position (world tiles), velocity (tiles/s),
   life (seconds), size (device px) and a colour that fades out
   as life drains. Splashes and seal droplets draw inside the
   camera transform; repair sparks are larger and draw above
   post-processing so they stay readable over the plumber.
   ============================================================ */

import { on, EVENT } from '../../util/events.js';
import { ctx, SCALE } from '../canvas.js';
import { MAP } from '../../config/constants.js';
import { pipeSplitAt } from '../pipe-layout.js';

const pool = [];
/** Hard limit for all live particle effects. */
export const MAX_PARTICLES = 200;
const PARTICLE_PRIORITY = Object.freeze({ splash:0, repair:1, seal:2 });
const REPAIR_SPARK_LIFE = 0.55; // Slight overlap keeps sparks present between 0.5s pulses.
let repairParticleCount = 0;

function addParticle(p, kind){
  p.kind = kind;
  p.priority = PARTICLE_PRIORITY[kind];
  if (pool.length >= MAX_PARTICLES){
    let replaceAt = pool.findIndex(existing => existing.priority < p.priority);
    if (replaceAt < 0 && (kind === 'seal' || kind === 'splash'))
      replaceAt = pool.findIndex(existing => existing.priority === p.priority);
    if (replaceAt < 0) return false;
    if (pool[replaceAt].kind === 'repair') repairParticleCount--;
    pool.splice(replaceAt, 1);
  }
  pool.push(p);
  if (kind === 'repair') repairParticleCount++;
  return true;
}

function makeParticle(x, y, vx, vy, gravity, life, size, color, maxLife = life){
  return { x, y, vx, vy, gravity, life, maxLife, size, color };
}

/* Spawn a splash from a wading step. */
on(EVENT.particle, (x, y)=>{
  const count = 5 + Math.floor(Math.random()*5);
  for (let i = 0; i < count; i++){
    const ang = Math.random()*6.2831;
    const sp  = 1.0 + Math.random()*2.0;
    addParticle(makeParticle(
      x + (Math.random()-0.5)*0.20,
      y + (Math.random()-0.5)*0.20,
      Math.cos(ang)*sp,
      Math.sin(ang)*sp - 1.0,
      6,
      0.30 + Math.random()*0.50,
      1 + Math.random()*1.5,
      'rgba(210,235,245,',
      1), 'splash');
  }
});

on(EVENT.sealBurst, (x, y)=>{
  for (let i = 0; i < 12; i++){
    const ang = i * (6.2831 / 12) + (Math.random()-0.5)*0.18;
    const sp = 1.2 + Math.random()*1.4;
    addParticle(makeParticle(
      x + (Math.random()-0.5)*0.08,
      y + (Math.random()-0.5)*0.08,
      Math.cos(ang)*sp,
      Math.sin(ang)*sp - 0.45,
      4,
      0.32 + Math.random()*0.28,
      1.2 + Math.random()*1.1,
      'rgba(230,250,255,'), 'seal');
  }
});

on(EVENT.repairSpark, (tileX, tileY)=>{
  const { x, y } = pipeSplitAt(tileX, tileY);
  for (let i = 0; i < 3; i++){
    const ang = i*(Math.PI*2/3) + (Math.random()-0.5)*0.18;
    const sp = 0.9 + Math.random()*0.6;
    addParticle(makeParticle(
      x,
      y,
      Math.cos(ang)*sp,
      Math.sin(ang)*sp,
      1.5,
      REPAIR_SPARK_LIFE,
      2.2 + Math.random()*0.8,
      'rgba(255,246,190,'), 'repair');
  }
});

on(EVENT.repairSparksClear, ()=>{
  for (let i = pool.length-1; i >= 0; i--)
    if (pool[i].kind === 'repair') pool.splice(i, 1);
  repairParticleCount = 0;
});

/** Returns the live particle count for capacity checks. */
export function getParticleCount(kind){
  if (kind === 'repair') return repairParticleCount;
  return kind ? pool.filter(p => p.kind === kind).length : pool.length;
}

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
    if (p.life <= 0){
      if (p.kind === 'repair') repairParticleCount--;
      pool.splice(i, 1);
    }
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
    if (p.kind !== 'repair') paintParticle(p, rc, rscale);
  }
  ctx.restore();
}

/** Draw repair sparks above the lighting and post-processing passes. */
export function drawRepairSparks(rc){
  if (repairParticleCount === 0) return;
  const rscale = 1/SCALE;
  ctx.save();
  ctx.setTransform(SCALE,0,0,SCALE,0,0);
  ctx.translate(rc.tx, rc.ty);
  ctx.globalCompositeOperation = 'lighter';
  for (const p of pool){
    if (p.kind === 'repair') paintParticle(p, rc, rscale);
  }
  ctx.restore();
}

function paintParticle(p, rc, rscale){
  const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
  if (alpha <= 0) return;
  if (p.x < rc.x0-1 || p.x > rc.x1+1 || p.y < rc.y0-1 || p.y > rc.y1+1) return;
  ctx.fillStyle = p.color + (alpha*0.9 + 0.05) + ')';
  ctx.beginPath();
  if (p.kind === 'repair'){
    const x = p.x*MAP.TILE_SIZE_PX, y = p.y*MAP.TILE_SIZE_PX;
    const outer = p.size*rscale, inner = outer*0.28;
    ctx.moveTo(x, y-outer);
    ctx.lineTo(x+inner, y-inner);
    ctx.lineTo(x+outer, y);
    ctx.lineTo(x+inner, y+inner);
    ctx.lineTo(x, y+outer);
    ctx.lineTo(x-inner, y+inner);
    ctx.lineTo(x-outer, y);
    ctx.lineTo(x-inner, y-inner);
  } else {
    ctx.arc(p.x*MAP.TILE_SIZE_PX, p.y*MAP.TILE_SIZE_PX, p.size*rscale, 0, 6.2831);
  }
  ctx.fill();
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
