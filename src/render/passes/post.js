import { VHS_PASS } from '../../config/constants.js';
import { G } from '../../sim/state.js';
import { SETTINGS } from '../../settings/store.js';
import { cvs, ctx } from '../canvas.js';
import { buildGrainFull, grainFull, scanPat } from '../textures.js';

/* A quarter-size copy of the screen, used by the chroma ghost. It does not
   belong to a floor, because the screen is the same size whichever floor is
   under it. It is kept here, next to vigCv and dangerCv below, for the same
   reason. */
let postCv = null;

/* ---------- Full-screen overlays, drawn from stored images ----------
   The vignette and the awareness wash are radial gradients covering the whole
   canvas. Drawing a stored image is cheaper than recomputing a gradient per
   pixel every frame, and they only change when the canvas size changes. */
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
     Both overlays are stored images (buildVignette and buildDangerWash). The
     lazy checks below rebuild them only when the canvas size changes. */
  if (!vigCv || vigCv.width!==cvs.width || vigCv.height!==cvs.height) buildVignette();
  /* The danger wash is half resolution, so the check compares against the size it
     WOULD be built at and not against cvs.width itself. */
  const dw = Math.max(1, cvs.width>>1), dh = Math.max(1, cvs.height>>1);
  if (!dangerCv || dangerCv.width!==dw || dangerCv.height!==dh) buildDangerWash();

  const seen = Math.min(1,G.seenBy);
  if (seen>0.01){
    ctx.globalAlpha = seen;
    ctx.drawImage(dangerCv, 0, 0, cvs.width, cvs.height);
    ctx.globalAlpha = 1;
  }
  /* The vignette. It frames the edges so the floor does not look like a wallpaper sample. */
  ctx.drawImage(vigCv, 0, 0);

  /* ---------- 8. VHS tape effect ----------
     A scrolling tracking band, scanlines, grain, a chroma ghost and dropouts.
     This pass makes the game look like a recording and not a window. It is
     always on. The snapshot is taken before the passes that read it.

     The strength is now a setting again (SETTINGS.crt). The default is 1.0, which
     is the full VHS_PASS and the exact look the game has always shipped. The
     setting is a fraction of the constant, not a replacement for it: VHS_PASS is
     still the ceiling and the identity of the tape look. */
  const vhs = VHS_PASS * SETTINGS.crt * (G.radar ? 5000 : 1);
  /* The snapshot gives the chroma ghost something to read that does not include
     the ghost itself. It is a QUARTER-size copy of the canvas, scaled back up
     with smoothing, which looks like a slightly soft ghost. It is still taken
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

  // Tracking band
  const bandY = ((t*0.055) % (cvs.height+220)) - 110;
  const tg=ctx.createLinearGradient(0,bandY,0,bandY+110);
  tg.addColorStop(0,'rgba(255,255,255,0)');
  tg.addColorStop(0.5,`rgba(255,248,220,${0.05 * VHS_PASS * SETTINGS.crt})`);
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