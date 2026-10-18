import { MAP_H, MAP_W, SHEEN_STEPS, TILE } from '../../config/constants.js';
import { hash2 } from '../../util/hash.js';
import { G } from '../../sim/state.js';
import { ctx } from '../canvas.js';

/* Scratch data for the water shine, one record per alpha bucket (SHEEN_STEPS,
   see config/constants.js). It is reused every frame so the pass allocates
   nothing. */
const sheenBuckets = Array.from({length:SHEEN_STEPS}, ()=>({ n:0, x0:0, y0:0, x1:0, y1:0 }));

export function ground(rc){
  const {t, x0, y0, x1, y1, vw, vh} = rc;
/* ---------- 1. Carpet ----------
   The carpet, its tonal variation, the wall faces and the wall tops never change
   while a floor is played, so they are baked once per floor (see bakeTiles). The
   visible part of each layer is copied with one drawImage. The source rectangle
   is the viewport in tiles on the map-sized canvas, and the destination is the
   same rectangle in world pixels, inside the camera transform. */
ctx.drawImage(G.tilesCv, x0*TILE, y0*TILE, vw*TILE, vh*TILE,
                          x0*TILE, y0*TILE, vw*TILE, vh*TILE);

/* ---------- 1b. The flood ----------
   Drawn AFTER the carpet and BEFORE the walls. That order is what makes it look
   like the floor is wet and not like a blue card floating over the room: the wall
   faces and tops are painted on top, so a partition in a flooded room stays dry.

   It is a single drawImage of a 76x76 image scaled up with smoothing. Per-tile
   fills would be slower (5776 draw calls) and would give hard, tile-aligned water
   edges on a feature whose whole job is a readable front. The image is refreshed
   by syncImages() when the water changes, not here. */
if (G.wetArr){
  ctx.globalAlpha = 1;
  ctx.drawImage(G.wetCv, 0, 0, MAP_W*TILE, MAP_H*TILE);

  /* The shine on deep water. Without it a flooded room is a flat tinted area
     that looks like a blue filter, and the highlight is what makes it look like a
     surface. It is only drawn on the deepest tiles, and only where the mask lets
     the player see them, so a dark flooded room stays dark.

     It is BATCHED into four alpha buckets: one path and one fill per bucket. It
     used to set a fill style from a template string and call fillRect for each
     tile (up to 400 per frame), measured at 7.8 ms. It was also the one pass whose
     cost grew with how much of the view was underwater, so it got slower exactly
     when the player was under pressure. The shimmer survives, because the alpha
     range is only 0 to 0.05, so four steps differ by 0.0125, below what banding
     on an additive pass can show. Each tile keeps its own phase, so the shine
     crawls and does not pulse as one sheet. */
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
  /* Each bucket is drawn by walking its bounding rectangle, instead of keeping a
     list of rectangles. The alpha follows the water depth, so a bucket's tiles
     are close together and the box is a handful of tiles, never more than the
     viewport. */
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

/* ---------- 2+3. Wall faces and tops ----------
   The second baked layer, drawn after the flood so a partition standing in a
   flooded room stays dry: the water lands on the carpet and the walls are painted
   over it. */
ctx.drawImage(G.wallsCv, x0*TILE, y0*TILE, vw*TILE, vh*TILE,
                           x0*TILE, y0*TILE, vw*TILE, vh*TILE);
}