import { VHS_PASS } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { cvs, ctx } from '../canvas.js';
import { buildGrainFull, grainFull, scanPat } from '../textures.js';

/* The source for the chroma ghost: a quarter-size copy of the SCREEN. It does
   not belong to a floor, because the screen is the same size whichever floor is
   under it. Keeping it on G meant recreating it (and leaving the old one for the
   garbage collector) whenever a floor changed. It is kept here, next to
   vigCv and dangerCv below, for the same reason. */
let postCv = null;

/* ---------- Full-screen overlays, drawn from stored images ----------
   The vignette and the awareness wash are radial gradients covering the whole
   canvas, and both were rebuilt and filled every frame. A gradient fill is worked
   out per pixel, while drawing a stored image is not, and these two only change
   when the canvas size does. A full-screen gradient costs about twice a
   full-screen drawImage, and was being paid sixty times a second for a picture
   that never moved.

   These are not new effects: the stops and radii are the same. The danger wash
   moves its per-frame `0.62*seen` alpha into globalAlpha, which is exactly what
   multiplying a gradient stop by a constant did. */
let vigCv = null, dangerCv = null;

// The vignette is canvas-sized: it is a fixed proportion of the frame.
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

/* The awareness wash (the red edge when a lifeform sees you) is HALF resolution.
   It is a smooth ramp with no sharp edge anywhere near a pixel, so scaling it up
   with smoothing looks the same as the full-size version. */
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

/* The tape dropout clock. This is the only state the pass keeps between frames.
   It lives here and not in render(), because a clock for a rate effect is not
   part of the camera. */
let dropT = 0;

export function post(rc){
  const {t} = rc;
/* ---------- 7. Danger and awareness ----------
   Both overlays are stored images (buildVignette and buildDangerWash). They are
   rebuilt when the canvas is resized, and the lazy checks below are a backup that
   costs nothing once the size has settled. */
if (!vigCv || vigCv.width!==cvs.width || vigCv.height!==cvs.height) buildVignette();
/* The danger wash is half resolution, so the check compares against the size it
   WOULD be built at and not against cvs.width itself. With an odd width, the half
   size never matched, so the wash was rebuilt every frame, which cost more than
   the gradient it replaced. */
const dw = Math.max(1, cvs.width>>1), dh = Math.max(1, cvs.height>>1);
if (!dangerCv || dangerCv.width!==dw || dangerCv.height!==dh) buildDangerWash();

const seen = Math.min(1,G.seenBy);
if (seen>0.01){
  ctx.globalAlpha = seen;
  ctx.drawImage(dangerCv, 0, 0, cvs.width, cvs.height);
  ctx.globalAlpha = 1;
}
/* The vignette. It was stronger (0.52) when the whole floor was lit and its only
   job was to stop the frame looking like a wallpaper sample. Now the room scope
   and the cone do the framing, and a vignette that strong eats the palette at the
   edges of the very room you are standing in. */
ctx.drawImage(vigCv, 0, 0);

/* ---------- 8. VHS tape effect ----------
   A scrolling tracking band, scanlines, grain, a chroma ghost and dropouts. This
   is the pass that makes the game look like a recording and not a window. It is
   always on: it was once a setting, but the two things players turned it down for
   (the scanline crawl and the shake) are still here at full strength, so a middle
   setting could not have been honest. The snapshot is taken before the passes
   that read it. */
const vhs = VHS_PASS;
/* The snapshot gives the chroma ghost something to read that does not include
   the ghost itself. It was a full-size copy of the canvas, and the ghost then
   drew that copy twice more at screen size: three full-screen operations for a
   3%-alpha smear 1 to 3 px wide. It is now a QUARTER-size copy, scaled back up
   with smoothing, which looks like a slightly soft ghost (which is what chroma
   bleed looks like anyway). It is still taken before every pass that reads it, so
   there is no feedback. */
const POST_S = 0.25;
const pw = Math.max(1, Math.round(cvs.width * POST_S));
const ph = Math.max(1, Math.round(cvs.height * POST_S));
if (!postCv || postCv.width!==pw || postCv.height!==ph){
  postCv = document.createElement('canvas');
  postCv.width = pw; postCv.height = ph;
}
const pg = postCv.getContext('2d');
pg.globalCompositeOperation='copy';
pg.setTransform(POST_S,0,0,POST_S,0,0);
pg.drawImage(cvs,0,0);
pg.setTransform(1,0,0,1,0,0);
pg.globalCompositeOperation='source-over';

// Tracking band
const bandY = ((t*0.055) % (cvs.height+220)) - 110;
const tg=ctx.createLinearGradient(0,bandY,0,bandY+110);
tg.addColorStop(0,'rgba(255,255,255,0)');
tg.addColorStop(0.5,`rgba(255,248,220,${0.05*vhs})`);
tg.addColorStop(1,'rgba(255,255,255,0)');
ctx.fillStyle=tg; ctx.fillRect(0,bandY,cvs.width,110);

// Scanlines
ctx.globalCompositeOperation='multiply';
ctx.globalAlpha = vhs;
ctx.fillStyle=scanPat;
ctx.fillRect(0,0,cvs.width,cvs.height);
ctx.globalAlpha = 1;
ctx.globalCompositeOperation='source-over';

// Grain
ctx.globalCompositeOperation='overlay';
ctx.globalAlpha=0.032*vhs;
if (!grainFull || grainFull.width!==cvs.width || grainFull.height!==cvs.height) buildGrainFull();
ctx.drawImage(grainFull, 0, 0);
ctx.globalAlpha=1;
ctx.globalCompositeOperation='source-over';

/* Chroma ghost, from the snapshot (bounded, so no feedback). The offset is in
   DEVICE pixels: the snapshot is drawn back at canvas size, so a shift of `ca`
   here is a shift of `ca` on screen. */
ctx.globalCompositeOperation='lighter';
ctx.globalAlpha=0.03*vhs;
ctx.imageSmoothingEnabled = false;     // a 4x nearest-neighbour upscale of a 3% smear
const ca = 1 + Math.round(Math.random()*2);
ctx.drawImage(postCv, -ca, 0, cvs.width, cvs.height);
ctx.drawImage(postCv,  ca, 0, cvs.width, cvs.height);
ctx.imageSmoothingEnabled = true;
ctx.globalAlpha=1;
ctx.globalCompositeOperation='source-over';

/* Dropouts. They run on a clock for the same reason the tube dropouts do: a
   per-frame chance would make the tape wear at whatever rate the display
   happens to run, and that is not a property of a recording. */
dropT += rc.dt;
while (dropT >= 0.05){
  dropT -= 0.05;
  if (Math.random() < 0.014*vhs){
    const y=(Math.random()*cvs.height)|0;
    ctx.fillStyle='rgba(210,206,190,0.14)';
    ctx.fillRect(0,y,cvs.width,1+Math.random()*2|0);
  }
}
}