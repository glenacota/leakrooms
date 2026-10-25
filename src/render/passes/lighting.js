import { FLICKER_DEPTH, MAP_H, MAP_W, TILE } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { fixtureVis } from '../../sim/vision.js';
import { cvs, ctx, SCALE } from '../canvas.js';

/* ---------- The ceiling-light glow sprite ----------
   Each lit fixture used to fill a rectangle of side 2*r*TILE under 'lighter'
   from a gradient built on the spot. The radius goes up to 19 tiles, so that
   rectangle is bigger than the screen, and one of them measured 9.5 ms. Drawing
   a pre-made sprite of the same size measured 1.4 ms, and the sprite is built
   once at boot.

   The three colour stops are the fluorescents' own colours, at the same alphas
   the old gradient used, at full strength. The per-frame strength is applied
   through globalAlpha. */
let glowSprite = null;
export function buildGlowSprite(){
  const S = 128;
  glowSprite = document.createElement('canvas');
  glowSprite.width = S; glowSprite.height = S;
  const g = glowSprite.getContext('2d');
  const gr = g.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  gr.addColorStop(0,   'rgba(228,230,168,1)');
  gr.addColorStop(0.5, 'rgba(225,226,187,0.4)');
  gr.addColorStop(1,   'rgba(198,197,139,0)');
  g.fillStyle = gr; g.fillRect(0,0,S,S);
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
    /* The tube itself has a FIXED physical size. It used to scale with the light
       radius (10 to 19 tiles), painting a 130 to 400 px additive slab per fixture,
       and two or three overlapping would blow the frame out to white. */
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