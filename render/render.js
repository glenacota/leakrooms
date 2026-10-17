import { FLICKER_DEPTH, MAP_H, MAP_W, SHEEN_STEPS, TILE, VHS_PASS } from '../config/constants.js';
import { REPAIR_TIME } from '../config/tuning.js';
import { hash2 } from '../util/hash.js';
import { G } from '../sim/state.js';
import { fixtureVis } from '../sim/vision.js';
import { cvs, ctx, SCALE } from './canvas.js';
import { ENT, drawDoor } from './entities.js';
import { syncImages } from './pack.js';
import { buildGrainFull, grainFull, scanPat } from './textures.js';

const sheenBuckets = Array.from({length:SHEEN_STEPS}, ()=>({ n:0, x0:0, y0:0, x1:0, y1:0 }));
/* Scratch for the sheen pass in render(): one record per alpha bucket (SHEEN_STEPS,
   see config/constants.js), reused every frame so the pass allocates nothing. */

/* ---- full-screen overlays, baked once instead of evaluated per pixel ----
   The vignette and the awareness wash are both radial gradients covering the
   whole canvas, and both were rebuilt and re-filled EVERY frame. A gradient
   fill is evaluated per pixel; an image blit is not, and these two change only
   when the canvas does. Measured on the reference machine at 1038x1025, a
   full-screen gradient costs roughly twice a full-screen drawImage, and it was
   being paid sixty times a second for a picture that never moved.

   Neither is a new effect: the ramps are the same stops at the same radii. The
   danger wash additionally drops its per-frame `0.62*seen` alpha into
   globalAlpha, which is exactly what a gradient stop multiplied by a constant
   was doing, only without the arithmetic. */
let vigCv = null, dangerCv = null;

/* The vignette is canvas-sized: it is a fixed proportion of the frame. */
export function buildVignette(){
  if (!cvs.width || !cvs.height) return;
  vigCv = document.createElement('canvas');
  vigCv.width = cvs.width; vigCv.height = cvs.height;
  const g = vigCv.getContext('2d');
  const vg = g.createRadialGradient(cvs.width/2, cvs.height/2, cvs.height*0.34,
                                    cvs.width/2, cvs.height/2, cvs.height*1.05);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.34)');
  g.fillStyle = vg; g.fillRect(0,0,cvs.width,cvs.height);
}

/* The awareness wash is HALF resolution. It is a smooth ramp with no edge in it
   anywhere near a pixel — the outer stop is 78% of the way out and everything
   inside that is a gradient anyway — so it is upscaled with smoothing into
   something no eye can separate from the full-res version. */
export function buildDangerWash(){
  if (!cvs.width || !cvs.height) return;
  const w = Math.max(1, cvs.width>>1), h = Math.max(1, cvs.height>>1);
  dangerCv = document.createElement('canvas');
  dangerCv.width = w; dangerCv.height = h;
  const g = dangerCv.getContext('2d');
  const vg = g.createRadialGradient(w/2, h/2, h*0.18, w/2, h/2, h*0.78);
  vg.addColorStop(0, 'rgba(216,80,60,0)');
  vg.addColorStop(1, 'rgba(150,26,16,0.62)');
  g.fillStyle = vg; g.fillRect(0,0,w,h);
}

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

/* ============================================================
   RENDER
   ============================================================ */
/* Where the fixed-step simulation has got into the step it is partway through.
   The loop owns the number and render only reads it, so it lives here with its
   one consumer and is written through a setter rather than assigned from out. */
export let simAlpha = 0;
export function setSimAlpha(v){ simAlpha = v; }

/* ---- camera ----
     ONE mapping, used everywhere:
        device_px = SCALE * (world_tiles*TILE + tx)
     so the player's own tile always lands at the centre of the viewport, and
     the light bake (which shares that origin) lines up with the geometry.
     The previous version mixed a pre-scaled offset with a device-space one and
     carried SCALE twice, which panned the world the wrong way and threw the
     player off-screen. */
export const cam = {x:0, y:0, jx:0, jy:0};

export function render(t){
    if (!G) return;
    syncImages();
    const p=G.player;

    // camera follow + breathing jitter.
    // Exponential smoothing with a TIME CONSTANT, not a fixed per-frame
    // fraction: 0.12/frame is twice as fast at 144fps as at 72fps, which
    // makes the camera lag inconsistently across machines.
    /* The camera eases toward the player on a wall-clock time constant, which
       is correct precisely because the world now advances on its own fixed
       clock: there is no longer a capped dt for the view to disagree with. */
    /* The smoothing constant is a TIME CONSTANT against the wall clock, which
       is correct now that the world advances on its own fixed clock: the camera
       is easing toward a position the simulation owns, and the ease takes 90ms
       regardless of how many steps got there. */
    const dt   = Math.max(0.001, Math.min(0.1, (t - (render.prevT || t-16))/1000));
    render.prevT = t;
    /* Elapsed seconds for the RATE clocks — the tube dropouts and the tape dropouts,
       which must fire at the same frequency per second on every machine.

       CLAMPED, and the clamp matters. Left unclamped, a tab that comes back from
       the background arrives with a delta of however long it was away — tens of
       seconds — and the dropout loops below run once per 50ms of it, so a single
       frame after a long pause issues thousands of draws. The clamp is generous
       enough that no real frame interval ever hits it (a quarter-second is a 4fps
       frame) and tight enough that the worst case is five iterations. Making up
       missed tape wear is not the point: nobody ever saw the frames they missed,
       so replaying them is work for no one. */
    render.dt = Math.min(0.25, Math.max(0, (t - (render.prevTRaw ?? (t-16)))/1000));
    render.prevTRaw = t;
    const k    = 1 - Math.exp(-dt/0.09);
    cam.x += (p.x - cam.x) * k;
    cam.y += (p.y - cam.y) * k;
    const breathe = Math.sin(t*0.0009)*0.06;
    /* Shake is a multiplier on the camera jitter, not a new system — the
       breathing motion and the VHS wobble were already here, and a settings
       slider that scales them turns both off at 0. */
    /* Camera jitter. Always on: the breathing sway and the handheld wobble were
       here before the slider existed, and a "camera shake" preference could
       only ever be OFF (0) or exactly what the game already did (1). Turning it
       down did not make the game calmer, it made the camera less honest.

       SCALED BY dt. This offset is a per-frame random draw, so at 30fps it
       delivers twice the displacement per second that it does at 60 — the
       handheld wobble was in fact half as lively on a slow machine, which is
       the opposite of what a struggling machine should look like. Scaling the
       amplitude by the square root of the frame ratio keeps the per-second
       character identical across refresh rates. */
    const jscale = Math.sqrt(dt/0.0167);
    cam.jx = (Math.random()-0.5)*0.10*jscale + breathe*0.35;
    cam.jy = (Math.random()-0.5)*0.10*jscale;

    // clamp to the maze so the viewport is never half off-map void
    const T = TILE*SCALE;
    const halfW = cvs.width /(2*T), halfH = cvs.height/(2*T);
    if (MAP_W > halfW*2) cam.x = Math.max(halfW, Math.min(MAP_W-halfW, cam.x));
    if (MAP_H > halfH*2) cam.y = Math.max(halfH, Math.min(MAP_H-halfH, cam.y));

    // translate applied inside the scaled context, in world pixels
    const tx = -cam.x*TILE + cvs.width /(2*SCALE) + cam.jx;
    const ty = -cam.y*TILE + cvs.height/(2*SCALE) + cam.jy;
    // same mapping, expressed in device pixels
    const dx = tx*SCALE, dy = ty*SCALE;
    const w2sx = wx => SCALE*(wx*TILE + tx);
    const w2sy = wy => SCALE*(wy*TILE + ty);

    // clean slate. Without this, anything the scene does not paint (the
    // off-map margin at the maze edges) keeps last frame's pixels and the
    // post-processors compound on top of it.
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,cvs.width,cvs.height);

    ctx.setTransform(SCALE,0,0,SCALE,0,0);
    ctx.save();
    ctx.translate(tx, ty);

    const tlx = Math.floor(cam.x - cvs.width /(2*T)) - 1;
    const tly = Math.floor(cam.y - cvs.height/(2*T)) - 1;
    const tw  = Math.ceil(cvs.width /T) + 3;
    const th  = Math.ceil(cvs.height/T) + 3;

    const x0=Math.max(0,tlx), y0=Math.max(0,tly);
  const x1=Math.min(MAP_W-1,tlx+tw), y1=Math.min(MAP_H-1,tly+th);
  const vw = x1-x0+1, vh = y1-y0+1;

  /* ---------- 1. carpet ----------
     Baked at floor build: the carpet, the hash2 tonal variation, the wall
     faces, the wall tops and their edge highlights are static, so the whole
     viewport slice of them is one drawImage each. Source rect is the viewport
     in TILES on the world-sized bake canvas; the destination is the same
     rectangle in world pixels, inside the same camera transform the per-tile
     fills used. */
  ctx.drawImage(G.tilesCv, x0*TILE, y0*TILE, vw*TILE, vh*TILE,
                            x0*TILE, y0*TILE, vw*TILE, vh*TILE);

  /* ---------- 1b. the flood ----------
     Drawn AFTER the carpet and BEFORE the walls, which is what makes it read as
     the floor being wet rather than a blue card floating over the room: the
     wall faces and tops are painted on top of it, so a partition standing in a
     flooded room stays dry and above the waterline.

     One drawImage of a 76x76 image upscaled with smoothing. Per-tile fills were
     the obvious alternative and would have been both slower (5776 draw calls)
     and worse — hard tile-aligned water edges, the same quantised boundary the
     vision cone has, on a feature whose entire job is a legible front. */
  /* The packed image is refreshed where G.wetArr changes, not here — see
     waterDirty. Drawing it is still one drawImage. */
  if (G.wetArr){
    ctx.globalAlpha = 1;
    ctx.drawImage(G.wetCv, 0, 0, MAP_W*TILE, MAP_H*TILE);

    /* Specular sheen on the deep water. Without it a flooded room is a flat
       tinted region and reads as "a blue filter is on" rather than as water;
       the highlight is what makes it look like a surface you could sink
       into. Drawn only on the deepest tiles and only where the mask can see
       them, so a dark flooded room is still dark.

       BATCHED, in four alpha buckets. It used to set a fillStyle built from a
       template literal and issue a fillRect for every qualifying tile — up to
       four hundred of them in a flooded viewport, each one a separate blended
       quad and a separate string allocation, measured at 7.8ms a frame on the
       reference machine. Worse, it is the one pass whose cost scales with how
       much of the view is underwater, so it got slower exactly when the player
       was already under pressure.

       One path and one fill per bucket is four draws for the whole sheen. The
       shimmer survives because the alpha range is 0 to 0.05: quantised into
       four steps that is a difference of 0.0125 on a 5%-alpha highlight, which
       is below what the banding on a `lighter` pass can show, and the phase is
       still per tile, so the sheen still crawls rather than pulsing as one
       sheet. */
    ctx.globalCompositeOperation = 'lighter';
    const shx0=Math.max(0,x0), shy0=Math.max(0,y0);
    const ph0 = t*0.0011;
    let bucket = sheenBuckets;
    for (let b=0;b<SHEEN_STEPS;b++) bucket[b].n = 0;
    for (let y=shy0;y<=y1;y++) for (let x=shx0;x<=x1;x++){
      const i=y*MAP_W+x;
      const w = G.wetArr[i];
      if (w < 0.55) continue;
      if (G.maskArr[i] < 0.05) continue;
      const n = hash2(x*7+3, y*11+5);
      const a = (w-0.55)/0.45 * 0.05 * (0.5+0.5*Math.sin(ph0 + n*6.28));
      if (a <= 0.003) continue;
      let k = (a/0.05*SHEEN_STEPS)|0;
      if (k >= SHEEN_STEPS) k = SHEEN_STEPS-1;
      const B = bucket[k];
      B.n++;
      if (B.n === 1) B.x0 = x, B.y0 = y, B.x1 = x+1, B.y1 = y+1;
      else { if (x   < B.x0) B.x0 = x;   if (y   < B.y0) B.y0 = y;
             if (x+1 > B.x1) B.x1 = x+1; if (y+1 > B.y1) B.y1 = y+1; }
    }
    /* Walk each bucket's rectangle rather than keeping a rect list: a bucket's
       tiles are contiguous in practice because the alpha follows the water
       depth, so the bounding box is a handful of tiles rather than four
       hundred, and it is bounded by the viewport either way. */
    for (let b=0;b<SHEEN_STEPS;b++){
      const B = bucket[b];
      if (!B.n) continue;
      const mid = ((b+0.5)/SHEEN_STEPS)*0.05;
      if (mid <= 0.003) continue;
      ctx.fillStyle = 'rgba(150,196,206,'+mid.toFixed(4)+')';
      ctx.beginPath();
      for (let y=B.y0;y<B.y1;y++) for (let x=B.x0;x<B.x1;x++){
        const i=y*MAP_W+x;
        const w = G.wetArr[i];
        if (w < 0.55 || G.maskArr[i] < 0.05) continue;
        const n = hash2(x*7+3, y*11+5);
        const a = (w-0.55)/0.45 * 0.05 * (0.5+0.5*Math.sin(ph0 + n*6.28));
        if (a <= 0.003) continue;
        let k = (a/0.05*SHEEN_STEPS)|0;
        if (k >= SHEEN_STEPS) k = SHEEN_STEPS-1;
        if (k !== b) continue;
        ctx.rect(x*TILE, y*TILE, TILE, TILE);
      }
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- 2+3. wall faces and tops ----------
     The second baked layer, drawn AFTER the flood so a partition standing in
     a flooded room stays dry: the water lands on the carpet and the walls are
     painted over it, exactly the order the per-tile passes used. */
  ctx.drawImage(G.wallsCv, x0*TILE, y0*TILE, vw*TILE, vh*TILE,
                             x0*TILE, y0*TILE, vw*TILE, vh*TILE);

  /* ---------- 4. world markers ---------- */
  for (const b of G.batteries){
    if (b.taken) continue;
    const bx=(b.x+0.5)*TILE, by=(b.y+0.5)*TILE;
    const pu = 1 + Math.sin(t*0.004)*0.12;
    ctx.fillStyle='rgba(20,17,8,0.45)'; ctx.fillRect(bx-9, by-11, 18, 22);
    ctx.fillStyle='#c8d97a'; ctx.fillRect(bx-7, by-9, 14, 18);
    ctx.fillStyle='#2c2a12'; ctx.fillRect(bx-5, by-7, 10, 5*pu+3);
    ctx.strokeStyle='rgba(232,217,138,0.5)'; ctx.lineWidth=1;
    ctx.strokeRect(bx-7.5, by-9.5, 15, 19);
  }

  /* The leak itself is drawn AFTER the lighting multiply — see section 6b.
     It is the one object in the world that is not gated by the cone, and the
     reason is written where it is drawn. */

  for (const e of G.exitTiles) drawDoor(e, t);

  /* ---------- 5. entities + player, y-sorted ----------
     Drawn at the INTERPOLATED position: `lerp(prev, now, simAlpha)`, where
     simAlpha is how far the fixed-step simulation has got into the step it is
     currently partway through. The simulation is quantised to 1/60s; this is
     not. The sort key is the interpolated y, so a figure also crosses in front
     of a wall at the moment it visually does. */
  const al = simAlpha;
  const ix = (e)=> e.px===undefined ? e.x : e.px + (e.x-e.px)*al;
  const iy = (e)=> e.py===undefined ? e.y : e.py + (e.y-e.py)*al;
  const draws = [];
  for (const a of G.agents) draws.push({y:iy(a), kind:'a', o:a});
  draws.push({y:iy(p), kind:'p', o:p});
  draws.sort((m,n)=> m.y-n.y);
  for (const d of draws){
    if (d.kind==='a') ENT.agent(d.o, t, ix(d.o), iy(d.o));
    else           ENT.player(p, t, ix(p), iy(p));
  }

  ctx.restore();

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
      f.dropT = (f.dropT||0) + render.dt;
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

  /* ---------- 7. danger / awareness ---------- */
  /* Both overlays below are baked images (buildVignette / buildDangerWash) and
     were full-screen gradients rebuilt and re-evaluated every frame. The
     awareness wash's strength now rides in globalAlpha, which is exactly what
     multiplying the gradient's outer stop by `seen` was doing. The images are
     rebuilt on resize(); the lazy rebuilds below are the belt to that braces,
     and cost nothing once the size has settled. */
  if (!vigCv || vigCv.width!==cvs.width || vigCv.height!==cvs.height) buildVignette();
  /* The danger wash is HALF resolution, so the guard has to compare against the
     size it would be BUILT at, not against cvs.width itself: an odd canvas
     width shifted right by one and the check never matched, which rebuilt the
     wash every frame and cost more than the gradient it replaced. */
  const dw = Math.max(1, cvs.width>>1), dh = Math.max(1, cvs.height>>1);
  if (!dangerCv || dangerCv.width!==dw || dangerCv.height!==dh) buildDangerWash();

  const seen = Math.min(1,G.seenBy);
  if (seen>0.01){
    ctx.globalAlpha = seen;
    ctx.drawImage(dangerCv, 0, 0, cvs.width, cvs.height);
    ctx.globalAlpha = 1;
  }
  /* Vignette. Was 0.52, which was tuned when the whole floor was lit and the
     only job was to stop the frame feeling like a wallpaper sample. With the
     room scoped and the cone doing the framing, a vignette that strong just
     eats the palette at the edges of the very room you are standing in. */
  ctx.drawImage(vigCv, 0, 0);

  /* ---------- 8. VHS composite ----------
     A lopping tracking band, a scanline grid, grain, a chroma ghost and
     dropouts. This is the pass that makes the game a recording rather than a
     window, and it is now unconditional: it was a slider once, and the two
     things people turned it down for — the scanline crawl and the shake — are
     both still here at full strength, so "tape degradation" as a preference
     could not honestly offer a middle. The snapshot is taken before the passes
     that read it. */
  const vhs = VHS_PASS;
  /* The snapshot exists so the chroma ghost has something to read that does not
     include itself. It was a FULL-RES copy of the canvas — a screen-sized
     read plus a screen-sized write, every frame — and the ghost then composited
     that copy twice more at screen size. Three full-screen operations to draw a
     3%-alpha, 1-3px offset smear.

     QUARTER RESOLUTION. Nothing about the effect can see the difference: the
     source is upscaled back to canvas size with smoothing on the way out, so a
     slightly soft ghost rather than a sharp one, which is what chroma bleed
     looks like anyway. What it buys is a quarter-res copy and two quarter-res
     composites in place of three full-screen ones. The snapshot is still taken
     before every pass that reads it, so there is no feedback. */
  const POST_S = 0.25;
  const pw = Math.max(1, Math.round(cvs.width * POST_S));
  const ph = Math.max(1, Math.round(cvs.height * POST_S));
  if (!G.postCv || G.postCv.width!==pw || G.postCv.height!==ph){
    G.postCv = document.createElement('canvas');
    G.postCv.width = pw; G.postCv.height = ph;
  }
  const pg = G.postCv.getContext('2d');
  pg.globalCompositeOperation='copy';
  pg.setTransform(POST_S,0,0,POST_S,0,0);
  pg.drawImage(cvs,0,0);
  pg.setTransform(1,0,0,1,0,0);
  pg.globalCompositeOperation='source-over';
  /* render.dt is consumed by the dropout clock below; re-seeded here so the
     first frame after a resize does not bank the whole boot-up delta. */
  if (render.dropT === undefined) render.dropT = 0;

  if (vhs > 0.01){
  // tracking band
  const bandY = ((t*0.055) % (cvs.height+220)) - 110;
  const tg=ctx.createLinearGradient(0,bandY,0,bandY+110);
  tg.addColorStop(0,'rgba(255,255,255,0)');
  tg.addColorStop(0.5,`rgba(255,248,220,${0.05*vhs})`);
  tg.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=tg; ctx.fillRect(0,bandY,cvs.width,110);

  // scanlines
  ctx.globalCompositeOperation='multiply';
  ctx.globalAlpha = vhs;
  ctx.fillStyle=scanPat;
  ctx.fillRect(0,0,cvs.width,cvs.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation='source-over';

  // grain
  ctx.globalCompositeOperation='overlay';
  ctx.globalAlpha=0.032*vhs;
  if (!grainFull || grainFull.width!==cvs.width || grainFull.height!==cvs.height) buildGrainFull();
  ctx.drawImage(grainFull, 0, 0);
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';

  // chromatic ghost, from the snapshot — bounded, no feedback.
  // The offset stays in DEVICE pixels: the snapshot is drawn back out at canvas
  // size, so a shift of `ca` here is a shift of `ca` on screen, exactly as it
  // was when the copy was 1:1.
  ctx.globalCompositeOperation='lighter';
  ctx.globalAlpha=0.03*vhs;
  ctx.imageSmoothingEnabled = false;     // a 4x nearest upscale of a 3% smear
  const ca = 1 + Math.round(Math.random()*2);
  ctx.drawImage(G.postCv, -ca, 0, cvs.width, cvs.height);
  ctx.drawImage(G.postCv,  ca, 0, cvs.width, cvs.height);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';

  // dropouts. On a clock, for the same reason the tube dropouts are: a
  // per-frame probability makes the tape wear at whatever rate the display
  // happens to run, which is not a property of a recording.
  render.dropT += render.dt;
  while (render.dropT >= 0.05){
    render.dropT -= 0.05;
    if (Math.random() < 0.014*vhs){
      const y=(Math.random()*cvs.height)|0;
      ctx.fillStyle='rgba(210,206,190,0.14)';
      ctx.fillRect(0,y,cvs.width,1+Math.random()*2|0);
    }
  }
  }   // end vhs
}
