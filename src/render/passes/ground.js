import { MAP_H, MAP_W, SHEEN_STEPS, TILE } from '../../config/constants.js';
import { hash2 } from '../../util/hash.js';
import { G } from '../../sim/state.js';
import { ctx } from '../canvas.js';

/* Scratch data for the water shine, one tile list per alpha bucket (SHEEN_STEPS,
   see config/constants.js). The lists are sized to the viewport and reused, so
   the pass allocates nothing. */
const bucketTiles = Array.from({length:SHEEN_STEPS}, ()=>null);
const bucketCount = new Int32Array(SHEEN_STEPS);

function bucketList(b, cap){
  let a = bucketTiles[b];
  if (!a || a.length < cap){ a = new Int32Array(cap); bucketTiles[b] = a; }
  return a;
}

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

     It is BATCHED into four alpha buckets, one path and one fill each. The alpha
     range is only 0 to 0.05, so four steps differ by 0.0125, below what banding
     on an additive pass can show. Each tile keeps its own phase, so the shine
     crawls and does not pulse as one sheet. */
  ctx.globalCompositeOperation = 'lighter';
  const shx0=Math.max(0,x0), shy0=Math.max(0,y0);
  const ph0 = t*0.0011;
  const cap = vw*vh;
  for (let b=0;b<SHEEN_STEPS;b++) bucketCount[b] = 0;
  /* First pass: classify each deep, visible tile once and remember it. The alpha
     needs a sine, and recomputing it per bucket meant a flooded view paid for
     every tile up to four times over. */
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
    bucketList(k, cap)[bucketCount[k]++] = i;
  }
  /* Second pass: one path and one fill per bucket, over the tiles it owns. */
  for (let b=0;b<SHEEN_STEPS;b++){
    const n = bucketCount[b];
    if (!n) continue;
    const mid = ((b+0.5)/SHEEN_STEPS)*0.05;
    if (mid <= 0.003) continue;
    ctx.fillStyle = 'rgba(150,196,206,'+mid.toFixed(4)+')';
    ctx.beginPath();
    const list = bucketTiles[b];
    for (let j=0;j<n;j++){
      const i = list[j];
      ctx.rect((i%MAP_W)*TILE, ((i/MAP_W)|0)*TILE, TILE, TILE);
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