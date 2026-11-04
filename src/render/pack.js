import { FACE_BACKLIGHT, FLOOR, MAP_H, MAP_W, VISION_PENUMBRA_TILES, WALL, WET_DRAW } from '../config/constants.js';
import { WATER_TINTS } from '../config/presets.js';
import { SETTINGS } from '../settings/store.js';
import { G } from '../sim/state.js';
import { repaintDirty, takeWetBox } from '../util/repaint.js';

/* The packers turn simulation arrays into small images. Switching this off
   skips the work for the tests that never read the images. setHeadless() in the
   test API controls it together with the vision flag. */
export let wantPixels = true;
export function setPixels(v){ wantPixels = !!v; }

/* ============================================================
   FLOOD FIELD TO IMAGE
   The water is one RGBA image with one pixel per tile, drawn scaled up with
   smoothing. It is a tint over the carpet and not an opaque fill, so it looks
   like the same carpet under water (darker and shifted in colour) and not like a
   blue card laid on top.

   Smoothing is not cosmetic. At one pixel per tile, a hard-edged waterline would
   crawl along the tile grid like a rendering fault. Bilinear scaling softens the
   front into an irregular edge at no per-frame cost.

   Dry tiles are written with alpha 0, never opaque black. The image is drawn
   over the carpet, and an untouched opaque black tile would paint black over it.

   The colour ramp is a straight blend between the two ends of the chosen tint
   (see WATER_TINTS). The ends were chosen by working out what the finished tile
   looks like over the carpet. Choosing colours that look like water on their own
   gave two bad versions: glowing ice, and a dark one that could not be told apart
   from an unlit floor, which ruins the mechanic.
   ============================================================ */
export function packWet(){
  if (!wantPixels) return;
  const T = WATER_TINTS[SETTINGS.waterHue] || WATER_TINTS.slate;
  const contrast = SETTINGS.waterContrast;
  const d = G.wetImg.data;
  /* Partial repack. takeWetBox() returns the rectangle of tiles that changed
     since the last pack, and only those rows are rewritten and uploaded. With a
     leak open the water moves every frame, but only in a thin band, so a full
     5776-tile rewrite (and a full upload) was a lot of wasted work. A full box
     means "repack everything", which a new floor and a tint change ask for. The
     box is used up here, so the next change starts a fresh one. */
  const { x0, y0, x1, y1 } = takeWetBox();
  for (let y=y0; y<=y1; y++){
    let i = y*MAP_W + x0;
    for (let x=x0; x<=x1; x++, i++){
      const a = G.wetArr[i];
      const k = i*4;
      if (a <= WET_DRAW){ d[k+3] = 0; continue; }
      const t = Math.min(1, a);
      const blue = Math.max(0, (t-0.35)/0.65);
      d[k]   = Math.round(T.damp[0] + (T.deep[0]-T.damp[0])*blue);
      d[k+1] = Math.round(T.damp[1] + (T.deep[1]-T.damp[1])*blue);
      d[k+2] = Math.round(T.damp[2] + (T.deep[2]-T.damp[2])*blue);
      d[k+3] = Math.round(255*Math.min(0.94, (0.34 + t*0.48)*contrast));
    }
  }
  const w = x1-x0+1, h = y1-y0+1;
  G.wetCtx.putImageData(G.wetImg, 0, 0, x0, y0, w, h);
}

/* Turns the visibility mask into an image. This is a pure brightness gate and
   not a colour, so it only writes grey. It costs 5776 writes when the view
   changes and nothing while you stand still. */
export function packMask(){
  if (!wantPixels) return;
  const d = G.maskImg.data;
  const { maskArr } = G;
  /* One-sided smoothstep feather over VISION_PENUMBRA_TILES tile(s).
     A lit tile that sits next to a darker tile is dimmed toward the dark
     neighbour; a lit tile surrounded by at-least-as-bright neighbours stays
     crisp, and pure black stays pure black. Darkness bleeds into light, never
     the other way round, so the playable area keeps full brightness and the
     black area keeps full depth. */
  const { grid } = G;
  /* A wall face is the south side of a wall tile with floor below it. Wall
     tiles without one are the inside of the block. Those are always dark, so
     they must not dim the face you are looking at. They also get a share of the
     face's light (FACE_BACKLIGHT), because the smoothed upscale would otherwise
     blend the edge of the face toward black. */
  const hasFace = (j, jy) => grid[j]===WALL && jy+1<MAP_H && grid[j+MAP_W]===FLOOR;
  const interior = (j, jy) => grid[j]===WALL && !hasFace(j, jy);
  let i = 0;
  for (let y=0; y<MAP_H; y++){
    for (let x=0; x<MAP_W; x++, i++){
      const v = maskArr[i];
      let out = v;
      const face = hasFace(i, y);
      if (v > 0){
        // Darkest orthogonal neighbour: only a darker neighbour can dim this tile.
        let nmin = v;
        if (x > 0       && maskArr[i-1]     < nmin && !(face && interior(i-1, y)))     nmin = maskArr[i-1];
        if (x+1 < MAP_W && maskArr[i+1]     < nmin && !(face && interior(i+1, y)))     nmin = maskArr[i+1];
        if (y > 0       && maskArr[i-MAP_W] < nmin && !(face && interior(i-MAP_W, y-1))) nmin = maskArr[i-MAP_W];
        if (y+1 < MAP_H && maskArr[i+MAP_W] < nmin) nmin = maskArr[i+MAP_W];
        if (nmin < v){
          const gap = v - nmin;                 // how much brighter than the darkest neighbour
          const s = gap*gap*(3 - 2*gap);        // smoothstep falloff across the penumbra
          // Spread the softening across VISION_PENUMBRA_TILES tile(s). With
          // width == 1 the edge tile sits at the penumbra midpoint (0.5), so
          // it is dimmed by up to half; a wider penumbra spreads that over more tiles.
          out = v * (1 - s * (0.5 / VISION_PENUMBRA_TILES));
        }
      }
      if (grid[i]===WALL && !face){
        let lit = 0;
        if (x > 0       && hasFace(i-1, y))     lit = Math.max(lit, maskArr[i-1]);
        if (x+1 < MAP_W && hasFace(i+1, y))     lit = Math.max(lit, maskArr[i+1]);
        if (y+1 < MAP_H && hasFace(i+MAP_W, y+1)) lit = Math.max(lit, maskArr[i+MAP_W]);
        if (lit*FACE_BACKLIGHT > out) out = lit*FACE_BACKLIGHT;
      }
      const b = Math.min(255, out * 255);
      const k = i*4;
      d[k]=b; d[k+1]=b; d[k+2]=b; d[k+3]=255;
    }
  }
  G.maskCtx.putImageData(G.maskImg, 0, 0);
}

/* Packs any stale image now, so render() never draws from a half-updated
   buffer. The pack functions still check wantPixels, so this does nothing in
   headless mode. */
export function syncImages(){
  if (repaintDirty.water){ packWet(); repaintDirty.water = false; }
  if (repaintDirty.mask){ packMask(); repaintDirty.mask = false; }
}