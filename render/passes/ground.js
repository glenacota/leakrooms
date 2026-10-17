import { MAP_H, MAP_W, SHEEN_STEPS, TILE } from '../../config/constants.js';
import { hash2 } from '../../util/hash.js';
import { G } from '../../sim/state.js';
import { ctx } from '../canvas.js';

const sheenBuckets = Array.from({length:SHEEN_STEPS}, ()=>({ n:0, x0:0, y0:0, x1:0, y1:0 }));
/* Scratch for the sheen pass: one record per alpha bucket (SHEEN_STEPS, see
   config/constants.js), reused every frame so the pass allocates nothing. */

export function ground(rc){
  const {t, x0, y0, x1, y1, vw, vh} = rc;
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
}
