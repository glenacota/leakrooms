import { MAP_W, TILE } from '../../config/constants.js';
import { REPAIR_TIME } from '../../config/tuning.js';
import { G } from '../../sim/state.js';
import { ctx, SCALE } from '../canvas.js';

export function leaks(rc){
  const {t, w2sx, w2sy} = rc;
/* ---------- 6b. the pipes ----------
   The one thing in the world that is not gated by the cone, and deliberately
   so. Drawn as part of the scene it would be multiplied by the mask along
   with everything else, which is correct from the next room and wrong from
   the doorway: the mechanic is that the WATER tells you where the leak is,
   and a cue that stops working the moment you arrive has taken the mechanic
   away at the only point it matters. Each pipe is drawn on its own tile's
   mask value, so the rule is per-pipe and not "nearest one wins" — you can be
   standing at a sealed pipe with another one still gushing a room away.

   It is still not the radar. It reveals one tile you are already standing
   next to, it costs no battery, and it does nothing at all while you are two
   rooms away — the G.maskArr lookup is a plain tile read and the radar's
   contract ("everything, full brightness, while the battery lasts") is not
   touched anywhere near this code. */
for (const L of G.leaks){
  /* DEVICE space, not world. This pass runs after ctx.restore(), so the
     context is back to identity and a world coordinate is just a raw pixel.
     The first version filled at L.x*TILE and drew the entire leak at
     (1360, 1360) — off screen, every frame, while every logic test passed
     and the leak was plainly absent from the screenshot. It is converted
     with the same w2s helpers the fixture pass uses, and sized in device
     pixels, which is why the flood (drawn earlier, inside the world
     transform) does not need this and the leak does. */
  const lt = L.y*MAP_W + L.x;
  if (!G.wetArr || G.maskArr[lt] <= 0.02) continue;
  const U  = TILE*SCALE;                 // one tile, in device pixels
  const fx = w2sx(L.x+0.5), fy = w2sy(L.y+0.5);
  const vis = G.maskArr[lt];
  ctx.save();
  ctx.globalAlpha = vis;

  if (!L.fixed){
    /* the split: a dark stain that runs DOWN the face and pools at the base,
       widening as it goes. The widening is what makes it read as liquid
       rather than as a stain-coloured rectangle. */
    const g1 = ctx.createLinearGradient(fx, fy-U/2, fx, fy+U/2);
    g1.addColorStop(0,   'rgba(28,44,48,0.95)');
    g1.addColorStop(0.35,'rgba(44,70,74,0.80)');
    g1.addColorStop(1,   'rgba(70,104,108,0.45)');
    ctx.fillStyle = g1;
    ctx.fillRect(fx-U*0.34, fy-U*0.40, U*0.68, U*0.90);
    /* wet halo on the carpet at the foot of the wall */
    const g2 = ctx.createRadialGradient(fx, fy+U*0.5, 1, fx, fy+U*0.5, U*0.95);
    g2.addColorStop(0,  'rgba(96,140,148,0.50)');
    g2.addColorStop(1,  'rgba(70,104,108,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(fx-U, fy-U*0.5, U*2, U*2);
    /* the jet — a thin bright line that pulses */
    const pulse = 0.5 + 0.5*Math.sin(t*0.006);
    ctx.fillStyle = `rgba(168,214,222,${0.30+0.30*pulse})`;
    ctx.fillRect(fx-U*0.06, fy-U*0.38, U*0.12, U*0.66);
  } else {
    /* sealed: a collar and a dry face. No halo, no jet. The absence is the
       feedback — you can tell from across the room that it is done. */
    ctx.fillStyle='rgba(120,132,74,0.92)';
    ctx.fillRect(fx-U*0.28, fy-U*0.16, U*0.56, U*0.24);
    ctx.fillStyle='rgba(228,230,168,0.55)';
    ctx.fillRect(fx-U*0.28, fy-U*0.16, U*0.56, U*0.05);
    ctx.fillStyle='rgba(28,44,48,0.55)';
    ctx.fillRect(fx-U*0.30, fy-U*0.36, U*0.60, U*0.22);
  }
  ctx.restore();

  /* The wrench ring is drawn UNMASKED but only while the player is physically
     at the pipe, which is a fact about where they are standing rather than
     an act of revealing. Losing it to a nearby partition would read as the
     repair stalling for no reason, and the ring is the only feedback the
     mechanic gives moment to moment. */
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
