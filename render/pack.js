import { MAP_H, MAP_W, WET_DRAW } from '../config/constants.js';
import { WATER_TINTS } from '../config/presets.js';
import { SETTINGS } from '../settings/store.js';
import { takeWetBox } from '../sim/flood.js';
import { G } from '../sim/state.js';

/* packMask / packWet write an image nobody will read. The switch travels with
   the packers: setHeadless() in game.js owns the call and setVision(), so the
   harness still switches both off with one call. */
export let wantPixels = true;
export function setPixels(v){ wantPixels = !!v; }

/* ============================================================
   FLOOD FIELD -> IMAGE
   One RGBA image at one pixel per tile, drawn scaled up with smoothing. The
   water is a MULTIPLY-STYLE tint rather than an opaque fill, so it reads as
   the same carpet under water instead of a blue card laid on top of it — the
   yellow is still there underneath, darkened and shifted, which is what wet
   carpet actually does.
   ============================================================ */
/* One pixel per tile, then upscaled with bilinear smoothing. The smoothing is
   not cosmetic: at one pixel per tile a hard-edged square waterline crawls
   along the tile grid as it advances and reads as a rendering fault, the same
   way the cone boundary used to. Bilinear across the tile grid turns the front
   into a soft irregular edge for free, and costs nothing per frame.

   Dry tiles are written with alpha 0, NOT with alpha 255 and black RGB. That
   is the bug this shape of the loop exists to prevent: the image is opaque, so
   an untouched tile is black and paints black over the carpet it is drawn on.

   The ramp is a straight lerp between the two ends of the selected tint, and
   the ends are picked by SOLVING for what the composited tile should look like
   over the carpet — see WATER_TINTS. Picking a colour that looks like water in
   isolation is what produced two wrong versions: one that read as glowing ice,
   and one so dark it was indistinguishable from an unlit floor, which defeats
   the mechanic entirely. */
export function packWet(){
  if (!wantPixels) return;
  const T = WATER_TINTS[SETTINGS.waterHue] || WATER_TINTS.slate;
  const contrast = SETTINGS.waterContrast;
  const d = G.wetImg.data;
  /* PARTIAL REPACK. The dirty box names the tiles that changed since the last
     pack, and only those rows are walked and only that rect is uploaded. With a
     pipe open the water moves every frame, so this used to be a full 5776-tile
     pass each time to repaint a band a few tiles across — and the upload was the
     expensive half, pushing the whole 76x76 image when a tenth of it had
     changed. An empty box means "repack everything", which is what initFlood, a
     tint change and the first frame after a floor build all ask for.

     The box is CONSUMED here: the pack is the upload, so after it the pending
     region is empty and the next writer starts a fresh one. */
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

/* Mask -> image. 5776 writes on a turn, nothing at all while standing still.
   Pure luminance: this is a visibility gate, not a colour. */
export function packMask(){
  if (!wantPixels) return;
  const d = G.maskImg.data;
  for (let i=0; i<MAP_W*MAP_H; i++){
    const b = Math.min(255, G.maskArr[i]*255);
    const k = i*4;
    d[k]=b; d[k+1]=b; d[k+2]=b; d[k+3]=255;
  }
  G.maskCtx.putImageData(G.maskImg, 0, 0);
}

/* Pack any stale pixel images now, so render() never draws a frame from a
   half-updated buffer. The pack functions themselves still gate on wantPixels,
   so this is a no-op in headless mode. */
export function syncImages(){
  if (G.dirty.water){ packWet(); G.dirty.water = false; }
  if (G.dirty.mask){ packMask(); G.dirty.mask = false; }
}
