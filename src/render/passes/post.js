import { VHS_PASS } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { cvs, ctx } from '../canvas.js';
import { buildGrainFull, grainFull, scanPat } from '../textures.js';

/* The ghost source. QUARTER RES resolution and it does not belong to a floor —
   it is a copy of the SCREEN, and the screen is the same size whichever floor
   is under it. On G it was recreated (and abandoned to the GC) whenever a floor
   changed, for a buffer whose size is decided by the canvas and nothing else.
   The vigCv/dangerCv pair below already keeps its state here for the same
   reason; this is the third member of that set. */
let postCv = null;

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

/* The tape dropout clock. It is the only state this pass keeps between frames,
   and it belongs to the pass rather than to render(): a rate clock is not a
   camera. */
let dropT = 0;

export function post(rc){
  const {t} = rc;
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
ctx.drawImage(postCv, -ca, 0, cvs.width, cvs.height);
ctx.drawImage(postCv,  ca, 0, cvs.width, cvs.height);
ctx.imageSmoothingEnabled = true;
ctx.globalAlpha=1;
ctx.globalCompositeOperation='source-over';

// dropouts. On a clock, for the same reason the tube dropouts are: a
// per-frame probability makes the tape wear at whatever rate the display
// happens to run, which is not a property of a recording.
dropT += rc.dt;
while (dropT >= 0.05){
  dropT -= 0.05;
  if (Math.random() < 0.014*vhs){
    const y=(Math.random()*cvs.height)|0;
    ctx.fillStyle='rgba(210,206,190,0.14)';
    ctx.fillRect(0,y,cvs.width,1+Math.random()*2|0);
  }
}
}   // end vhs
}
