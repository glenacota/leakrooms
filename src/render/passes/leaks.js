import { MAP_W, TILE } from '../../config/constants.js';
import { WATER_TINTS } from '../../config/presets.js';
import { REPAIR_TIME } from '../../config/tuning.js';
import { SETTINGS } from '../../settings/store.js';
import { G } from '../../sim/state.js';
import { hash2 } from '../../util/hash.js';
import { ctx, SCALE } from '../canvas.js';
import { dropAt, pipeFlipped, pipeLayout, waterCss } from '../pipe-layout.js';

/* The pipe's colours: greys with the green cast of the wallpaper, so it sits on the
   wall and not on top of it. The collars are a shade darker, and each has a darker
   right half like the flat art it is drawn after. */
const BODY = '#a6a893', LIGHT = '#bcbea8', SHADE = '#8b8e77';
const COLLAR = '#8e917a', COLLAR_DARK = '#76795f';
const INK = 'rgba(26,28,16,0.62)', CRACK_INK = '#15130c';
const CLAMP_YELLOW = '#e8c11f', CLAMP_INK = '#1c1a14';

/* Draws a layout rectangle. (ox, oy) is the band's top-left in device pixels, U
   one tile in device pixels. */
function rect(r, ox, oy, U){ ctx.fillRect(ox + r.x*U, oy + r.y*U, r.w*U, r.h*U); }

/* The pipe body: the riser, the elbow with its rounded outer corner, and the run,
   as ONE path, so the outline has no seam where the two meet. */
function bodyPath(P, ox, oy, U){
  const { run, riser } = P.rects;
  const right = P.elbowRight, dir = right ? 1 : -1;
  const inner = right ? riser.x : riser.x + riser.w, outer = right ? riser.x + riser.w : riser.x;
  const free  = right ? run.x : run.x + run.w;
  const top = run.y, bottom = run.y + run.h, rad = 0.075;
  const X = (x)=> ox + x*U, Y = (y)=> oy + y*U;
  ctx.beginPath();
  ctx.moveTo(X(free), Y(top));
  ctx.lineTo(X(inner), Y(top));
  ctx.lineTo(X(inner), Y(0));
  ctx.lineTo(X(outer), Y(0));
  ctx.lineTo(X(outer), Y(bottom - rad));
  ctx.quadraticCurveTo(X(outer), Y(bottom), X(outer - dir*rad), Y(bottom));
  ctx.lineTo(X(free), Y(bottom));
  ctx.closePath();
}

function drawPipe(P, ox, oy, U){
  const { run, riser } = P.rects;
  bodyPath(P, ox, oy, U);
  ctx.fillStyle = BODY; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = SHADE; rect(P.rects.runShade, ox, oy, U);               // the darker underside
  ctx.fillStyle = LIGHT;
  ctx.fillRect(ox + (P.elbowRight ? riser.x : riser.x + riser.w - 0.045)*U, oy, 0.045*U, run.y*U); // light edge of the riser
  ctx.fillRect(ox + run.x*U, oy + run.y*U, run.w*U, 0.025*U);             // light edge of the run
  ctx.restore();
  bodyPath(P, ox, oy, U);
  ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, U*0.02); ctx.stroke();
  for (const k of ['endCollar', 'midCollar', 'topCollar']){
    const r = P.rects[k];
    ctx.fillStyle = COLLAR; rect(r, ox, oy, U);
    ctx.fillStyle = COLLAR_DARK; ctx.fillRect(ox + (r.x + r.w/2)*U, oy + r.y*U, r.w/2*U, r.h*U);
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, U*0.015);
    ctx.strokeRect(ox + r.x*U, oy + r.y*U, r.w*U, r.h*U);
  }
}

/* The split: a black jagged shape in the elbow's underside. */
function drawCrack(P, ox, oy, U){
  ctx.fillStyle = CRACK_INK;
  ctx.beginPath();
  P.crack.forEach(([x,y], i) => i ? ctx.lineTo(ox + x*U, oy + y*U) : ctx.moveTo(ox + x*U, oy + y*U));
  ctx.closePath(); ctx.fill();
}

/* The hazard clamp that closes the split once it is sealed. */
function drawClamp(P, ox, oy, U){
  const r = P.rects.clamp, x = ox + r.x*U, y = oy + r.y*U, w = r.w*U, h = r.h*U;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = CLAMP_YELLOW; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = CLAMP_INK; ctx.lineWidth = Math.max(2, U*0.04);
  for (let i=-2; i<=3; i++){ ctx.beginPath(); ctx.moveTo(x+i*w*0.4-w*0.25, y); ctx.lineTo(x+i*w*0.4+w*0.25, y+h); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(24,26,16,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
}

/* The pool on the carpet below the pipe. Static: it does not grow with the flood. */
function drawPuddle(P, ox, oy, U, deep){
  ctx.fillStyle = waterCss(deep, 0.38, 0.92);
  for (const [cx, cy, rx, ry] of P.puddle){
    ctx.beginPath(); ctx.ellipse(ox + cx*U, oy + cy*U, rx*U, ry*U, 0, 0, 6.283); ctx.fill();
  }
  const [gx, gy, grx, gry] = P.glint;
  ctx.fillStyle = waterCss(deep, 0.78, 0.85);
  ctx.beginPath(); ctx.ellipse(ox + gx*U, oy + gy*U, grx*U, gry*U, -0.08, 0, 6.283); ctx.fill();
}

/* The drop: a bead that swells at the split, then a teardrop that falls onto the
   puddle, which ripples where it lands. */
function drawDrop(P, ox, oy, U, deep, phase){
  const d = dropAt(phase), x = ox + P.dropFrom.x*U, y = oy + d.y*U, r = d.r*U;
  if (d.ripple > 0){
    const lx = ox + P.dropFrom.x*U, ly = oy + 0.72*U;
    ctx.strokeStyle = waterCss(deep, 0.85, 0.7*(1 - d.ripple)); ctx.lineWidth = Math.max(1, U*0.012);
    ctx.beginPath(); ctx.ellipse(lx, ly, U*(0.02 + 0.07*d.ripple), U*(0.008 + 0.025*d.ripple), 0, 0, 6.283); ctx.stroke();
  }
  ctx.fillStyle = waterCss(deep, 0.6, 0.95);
  ctx.beginPath();
  if (d.kind === 'fall'){
    ctx.moveTo(x, y - r*2.3);
    ctx.quadraticCurveTo(x + r*0.95, y - r*0.7, x + r, y);
    ctx.arc(x, y, r, 0, Math.PI, false);
    ctx.quadraticCurveTo(x - r*0.95, y - r*0.7, x, y - r*2.3);
  } else {
    ctx.ellipse(x, y + r*0.4, r, r*1.15, 0, 0, 6.283);
  }
  ctx.fill();
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
     battery, and does nothing from two rooms away.

     WHERE: a pipe is on the SOUTH face of its wall tile, the wallpaper band the
     bake paints into the top of the floor tile below it, the only wall face the
     player ever sees. The level places pipes only on such walls (see genLevel), and
     pipe-layout.js has the geometry. */
  for (const L of G.leaks){
    /* DEVICE space, not world space. This pass runs after ctx.restore(), so the
       context is back to the identity and a world coordinate would be a raw pixel.
       Coordinates are converted with the same w2s helpers the lighting pass uses,
       and sizes are in device pixels. */
    const lt = L.y*MAP_W + L.x;
    if (!G.wetArr || G.maskArr[lt] <= 0.02) continue;
    const U  = TILE*SCALE;                 // one tile, in device pixels
    const ox = w2sx(L.x), oy = w2sy(L.y+1); // top-left of the wall face band
    const vis = G.maskArr[lt];
    const P = pipeLayout(pipeFlipped(L.x, L.y));
    const deep = (WATER_TINTS[SETTINGS.waterHue] || WATER_TINTS.slate).deep;
    ctx.save();
    ctx.globalAlpha = vis;

    if (!L.fixed){
      drawPuddle(P, ox, oy, U, deep);
      // The wet run down the wallpaper, from the split to the carpet
      const s = P.rects.streak;
      ctx.fillStyle = waterCss(deep, 0.1, 0.38);
      ctx.fillRect(ox + s.x*U, oy + s.y*U, s.w*U, s.h*U);
      drawPipe(P, ox, oy, U);
      drawCrack(P, ox, oy, U);
      drawDrop(P, ox, oy, U, deep, t/1400 + hash2(L.x*3+1, L.y));
    } else {
      /* Sealed: the same pipe with the split closed under a hazard clamp, and no
         drop and no puddle. The missing water is the feedback: you can tell from
         across the room that it is done. */
      drawPipe(P, ox, oy, U);
      drawClamp(P, ox, oy, U);
    }
    ctx.restore();
  }
}

/* The wrench ring is drawn WITHOUT the mask, but only while the player is at
   the pipe. That is a fact about where they stand and not an act of revealing.
   Losing it to a nearby partition would look like the repair stalling for no
   reason, and the ring is the only moment-to-moment feedback the repair gives.
   Drawn after post() so the radar's green wash and the VHS pass cannot touch it. */
export function repairRing(rc){
  const {w2sx, w2sy} = rc;
  const U = TILE*SCALE;
  for (const L of G.leaks){
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
