import { FLICKER_DEPTH, MAP_H, MAP_W, TILE } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { fixtureVis } from '../../sim/vision.js';
import { cvs, ctx, SCALE } from '../canvas.js';

/* ---- the fixture glow sprite ----
   Every lit fixture filled a rect of side 2*r*TILE under 'lighter' from a
   gradient built on the spot — and r runs to 19 tiles, so that rect is bigger
   than the screen. One of those measured 9.5ms. A textured quad of the same
   size measured 1.4ms, and the sprite is built once at boot.

   The three stops are the fluorescents' own colours at the alphas the old
   gradient used, baked at full strength; the per-frame strength now rides in
   globalAlpha, which is what a gradient stop multiplied by `a` was doing. */
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
/* ---------- 6. lighting ---------- */
ctx.setTransform(1,0,0,1,0,0);

// ambient bake (multiply) — mono-yellow, and only where the character can see
ctx.globalCompositeOperation='multiply';
ctx.imageSmoothingEnabled = true;
ctx.drawImage(G.lightCv, dx, dy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);

/* The visibility mask: room scope x distance x cone, or everything at once
   while the radar sweeps. One multiply. Multiplicative, not additive, so it
   can only ever REMOVE light the bake put there — which is the whole point. */
ctx.drawImage(G.maskCv, dx, dy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);

/* flickering fluorescents (additive, above the bake).
   GATED BY VISIBILITY. The bake is a multiply, so an unlit room is already
   dark — but this pass is 'lighter', which ADDS light on top of whatever
   the bake left. Left ungated it paints every fixture on the floor at full
   strength, so every "dark" room would have its tube blazing in it and the
   room scoping would be invisible. */
ctx.globalCompositeOperation='lighter';
for (const f of G.fixtures){
  const fv = fixtureVis(f);
  if (fv < 0.02) continue;
  let a = 0.12 * fv;
  /* Fluorescent flicker. 16% of fixtures stutter, a 2%-per-frame dropout dips
     a tube to 15%, and the VHS pass adds its own on top. The depth and the
     dropout were a three-way preference once; they are now simply what a
     fluorescent tube does, at FLICKER_DEPTH. The hum is the room's whole
     character — a perfectly steady light reads as a bug, not as calm. */
  if (f.flicker){
    a *= (1-FLICKER_DEPTH + FLICKER_DEPTH*Math.max(0, Math.sin(t*0.001*f.flicker + f.phase)));
    /* The dropout is on a CLOCK, not on a frame. `Math.random()<0.02` per
       frame means a 30Hz machine gets twice as many dropouts per second as a
       60Hz one — the room's lighting character was quietly a function of the
       player's refresh rate. One draw per 1/20s of elapsed time is the same
       tube on every machine. */
    f.dropT = (f.dropT||0) + dt;
    while (f.dropT >= 0.05){ f.dropT -= 0.05; if (Math.random()<0.05) a*=0.15; }
  }
  const fx=w2sx(f.x), fy=w2sy(f.y);
  const rr=f.r*T;
  if (fx<-rr||fy<-rr||fx>cvs.width+rr||fy>cvs.height+rr) continue;
  /* One textured quad instead of a screen-sized gradient rebuilt per fixture
     per frame. Same ramp, same alpha (it rides in globalAlpha now), and the
     sprite is a quarter of the cost: a gradient fill evaluates its stops at
     every pixel it covers, a drawImage samples a texture — and this rect is
     routinely larger than the viewport, because r goes up to 19 tiles. */
  ctx.globalAlpha = a;
  ctx.drawImage(glowSprite, fx-rr, fy-rr, rr*2, rr*2);
  ctx.globalAlpha = 1;
  /* The tube itself must be a FIXED physical size. It used to scale with
     f.r (the 10-19 tile light radius), painting a 130-400px additive slab
     per fixture; two or three overlapping blew the whole frame to white. */
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

/* No additive pass for the radar. It is tempting: sweep a bright wash over the
   frame to suggest the device firing. But the mask has already multiplied
   every dark room down to black, so an additive wash paints a yellow haze
   onto an empty frame — a glow with no room in it, which reads as a
   rendering fault rather than as light. The radar reveals because the mask
   never zeroed anything while it was on. */
ctx.globalCompositeOperation='source-over';
}
