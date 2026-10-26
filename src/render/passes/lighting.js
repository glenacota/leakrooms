import { FLICKER_DEPTH, MAP_H, MAP_W, TILE } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { fixtureVis } from '../../sim/vision.js';
import { cvs, ctx, SCALE } from '../canvas.js';
import { radialSprite } from '../sprites.js';

/* ---------- The ceiling-light glow sprite ----------
   Each lit fixture draws a pre-made sprite instead of a per-frame gradient,
   built once at boot. The three colour stops are the fluorescents' own colours,
   at full strength. The per-frame strength is applied through globalAlpha. */
let glowSprite = null;
export function buildGlowSprite(){
  const S = 128;
  glowSprite = radialSprite(S,S,{
    cx:S/2, cy:S/2, r0:0, r1:S/2,
    stops:[[0,'rgba(228,230,168,1)'],[0.5,'rgba(225,226,187,0.4)'],[1,'rgba(198,197,139,0)']]
  });
}

export function lighting(rc){
  const {t, dt, dx, dy, T, w2sx, w2sy} = rc;
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

  /* Flickering fluorescent tubes (additive, drawn above the bake).

     They are gated by visibility. The bake is a multiply, so an unlit room is
     already dark, but this pass is 'lighter', which ADDS light on top of whatever
     the bake left. Without the gate, every tube on the floor would blaze at full
     strength and every "dark" room would be lit, hiding the room scoping. */
  ctx.globalCompositeOperation='lighter';
  for (const f of G.fixtures){
    const fv = fixtureVis(f, G);
    if (fv < 0.02) continue;
    let a = 0.12 * fv;
    /* Flicker. 16% of the tubes stutter, a random dropout dips a tube to 15%, and
       the tape pass adds its own flicker on top. This is simply how a fluorescent
       tube looks (at FLICKER_DEPTH): a perfectly steady light would look like a bug,
       not like calm. */
    if (f.flicker){
      a *= (1-FLICKER_DEPTH + FLICKER_DEPTH*Math.max(0, Math.sin(t*0.001*f.flicker + f.phase)));
      /* The dropout runs on a CLOCK and not on a frame. A chance per frame would
         give a 30 Hz screen twice as many dropouts per second as a 60 Hz one, so
         the lighting would depend on the refresh rate. One draw per 1/20 s of
         elapsed time gives the same tube on every machine. */
      f.dropT = (f.dropT||0) + dt;
      while (f.dropT >= 0.05){ f.dropT -= 0.05; if (Math.random()<0.05) a*=0.15; }
    }
    const fx=w2sx(f.x), fy=w2sy(f.y);
    const rr=f.r*T;
    if (fx<-rr||fy<-rr||fx>cvs.width+rr||fy>cvs.height+rr) continue;
    // The glow is one scaled sprite (see above), with its strength in globalAlpha
    ctx.globalAlpha = a;
    ctx.drawImage(glowSprite, fx-rr, fy-rr, rr*2, rr*2);
    ctx.globalAlpha = 1;
    /* The tube itself has a FIXED physical size. */
    const tw2 = 2.4*T, th2 = 0.34*T;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(f.phase);
    ctx.fillStyle=`rgba(228,230,168,${(0.10 + a*0.5)*fv})`;
    ctx.fillRect(-tw2/2, -th2/2, tw2, th2);
    ctx.fillStyle=`rgba(225,226,187,${0.10*fv})`;
    ctx.fillRect(-tw2/2, -th2/2, tw2, th2*0.45);
    ctx.restore();
  }

  /* The radar reveals the whole floor, so while it is on the frame is tinted the
     classic green-phosphor radar instead of the warm yellow the palette uses
     everywhere else. It is a multiply over the map and not a second mask: the mask
     already owns brightness, and this only shifts the revealed palette's hue. It
     runs after the tubes so they tint green too, the way they do on a phosphor
     screen. */
  if (G.radar){
    ctx.globalCompositeOperation='multiply';
    ctx.fillStyle='rgb(14, 83, 18)';
    ctx.fillRect(dx, dy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);
  }

  ctx.globalCompositeOperation='source-over';
}