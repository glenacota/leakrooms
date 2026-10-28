import { MAP_W, TILE } from '../../config/constants.js';
import { REPAIR_TIME } from '../../config/tuning.js';
import { G } from '../../sim/state.js';
import { ctx, SCALE } from '../canvas.js';

/* The pipe: a horizontal run across the tile with a flange at each end, in device
   pixels like everything in this pass. */
function pipeRun(fx, fy, U){
  ctx.fillStyle='#8b8f7a'; ctx.fillRect(fx-U*0.5, fy-U*0.12, U, U*0.2);
  ctx.fillStyle='rgba(255,255,230,0.28)'; ctx.fillRect(fx-U*0.5, fy-U*0.10, U, U*0.04);
  ctx.fillStyle='#6f7362';
  ctx.fillRect(fx-U*0.34, fy-U*0.16, U*0.07, U*0.28); ctx.fillRect(fx+U*0.27, fy-U*0.16, U*0.07, U*0.28);
}

/* A hazard-striped clamp over the split. */
function clamp(fx, fy, U, col){
  const w = U*0.26, h = U*0.30, x = fx-w/2, y = fy-U*0.17;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#1c1a14'; ctx.lineWidth = Math.max(2, U*0.05);
  for (let i=-2; i<=3; i++){ ctx.beginPath(); ctx.moveTo(x+i*w*0.4-w*0.25, y); ctx.lineTo(x+i*w*0.4+w*0.25, y+h); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle='rgba(24,26,16,0.6)'; ctx.lineWidth=1; ctx.strokeRect(x, y, w, h);
}

export function leaks(rc){
  const {t, w2sx, w2sy} = rc;
  /* ---------- 6b. The pipes ----------
     The one thing in the world that the cone of vision does not hide, on purpose.
     Drawn as part of the scene, a pipe would be multiplied by the mask like
     everything else, which is right from the next room and wrong from the
     doorway. The mechanic is that the WATER tells you where the leak is, and a clue
     that stops working when you arrive removes the mechanic at the one moment it
     matters. Each pipe uses its own tile's mask value, so the rule is per pipe: you
     can stand at a sealed pipe while another is still gushing a room away.

     This is still not the radar. It shows one tile you are already next to, costs no
     battery, and does nothing from two rooms away. */
  for (const L of G.leaks){
    /* DEVICE space, not world space. This pass runs after ctx.restore(), so the
       context is back to the identity and a world coordinate would be a raw pixel.
       Coordinates are converted with the same w2s helpers the lighting pass uses,
       and sizes are in device pixels. */
    const lt = L.y*MAP_W + L.x;
    if (!G.wetArr || G.maskArr[lt] <= 0.02) continue;
    const U  = TILE*SCALE;                 // one tile, in device pixels
    const fx = w2sx(L.x+0.5), fy = w2sy(L.y+0.5);
    const vis = G.maskArr[lt];
    ctx.save();
    ctx.globalAlpha = vis;

    if (!L.fixed){
      /* The split: a dark stain that runs down the wall face and pools at the base,
         getting wider as it goes. The widening is what makes it look like liquid
         and not a stain-coloured rectangle. */
      const g1 = ctx.createLinearGradient(fx, fy-U/2, fx, fy+U/2);
      g1.addColorStop(0,   'rgba(28,44,48,0.95)');
      g1.addColorStop(0.35,'rgba(44,70,74,0.80)');
      g1.addColorStop(1,   'rgba(70,104,108,0.45)');
      ctx.fillStyle = g1;
      ctx.fillRect(fx-U*0.34, fy-U*0.40, U*0.68, U*0.90);
      // A wet halo on the carpet at the foot of the wall
      const g2 = ctx.createRadialGradient(fx, fy+U*0.5, 1, fx, fy+U*0.5, U*0.95);
      g2.addColorStop(0,  'rgba(96,140,148,0.50)');
      g2.addColorStop(1,  'rgba(70,104,108,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(fx-U, fy-U*0.5, U*2, U*2);
      pipeRun(fx, fy, U);
      clamp(fx, fy, U, '#e8c11f');
      // Drops creep out of the clamp and fall toward the halo
      for (let i=0; i<4; i++){
        const u = (t*0.0007 + i/4) % 1, r = U*(0.018+0.03*u);
        ctx.fillStyle = `rgba(190,230,238,${1-u*0.6})`;
        ctx.beginPath(); ctx.ellipse(fx-U*0.09+i*U*0.06, fy+U*0.07+u*U*0.34, r, r*(1+u*0.5), 0, 0, 6.283); ctx.fill();
      }
    } else {
      /* Sealed: a collar and a dry face, with no halo and no jet. The missing
         water is the feedback: you can tell from across the room that it is done. */
      pipeRun(fx, fy, U);
      ctx.fillStyle='rgba(120,132,74,0.92)';
      ctx.fillRect(fx-U*0.28, fy-U*0.16, U*0.56, U*0.24);
      ctx.fillStyle='rgba(228,230,168,0.55)';
      ctx.fillRect(fx-U*0.28, fy-U*0.16, U*0.56, U*0.05);
      ctx.fillStyle='rgba(28,44,48,0.55)';
      ctx.fillRect(fx-U*0.30, fy-U*0.36, U*0.60, U*0.22);
    }
    ctx.restore();

    /* The wrench ring is drawn WITHOUT the mask, but only while the player is at
       the pipe. That is a fact about where they stand and not an act of revealing.
       Losing it to a nearby partition would look like the repair stalling for no
       reason, and the ring is the only moment-to-moment feedback the repair gives. */
    if (L.repair > 0 && !L.fixed){
      const rx = w2sx(L.sx+0.5), ry = w2sy(L.sy+0.5), rr = U*0.62;
      const prog = L.repair/REPAIR_TIME;
      ctx.strokeStyle = 'rgba(20,24,18,0.75)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(rx, ry, rr, 0, 6.283); ctx.stroke();
      ctx.strokeStyle = 'rgba(158,214,224,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(rx, ry, rr, -Math.PI/2, -Math.PI/2 + prog*6.283);
      ctx.stroke();
    }
  }
}