import { on } from '../util/events.js';
import { cvs, ctx } from './canvas.js';
import { PAL } from '../config/palette.js';

export let carpetPat, wallPat, ceilPat, scanPat, grainFull;

/* Builds the repeating patterns used by the renderer. Everything is drawn in
   code, so the game needs no image files. */
export function buildPatterns(){
  // Carpet: a 64x64 speckled tile
  let c = document.createElement('canvas'); c.width=c.height=64;
  let g = c.getContext('2d');
  g.fillStyle=PAL.carpet; g.fillRect(0,0,64,64);
  for(let i=0;i<2600;i++){
    const x=Math.random()*64, y=Math.random()*64;
    const v = Math.random();
    g.fillStyle = v<0.4 ? 'rgba(150,156,74,0.30)' : 'rgba(228,230,168,0.28)';
    g.fillRect(x,y,1.6,1.6);
  }
  for(let i=0;i<260;i++){           // faint tile seams
    g.fillStyle='rgba(150,156,74,0.14)';
    g.fillRect(Math.random()*64|0, Math.random()*64|0, 2,2);
  }
  carpetPat = ctx.createPattern(c,'repeat');

  // Wallpaper on wall faces: a vertical dotted pattern
  c = document.createElement('canvas'); c.width=32; c.height=48;
  g = c.getContext('2d');
  const grd = g.createLinearGradient(0,0,0,48);
  grd.addColorStop(0,PAL.bright); grd.addColorStop(0.55,PAL.pale); grd.addColorStop(1,PAL.mid);
  g.fillStyle=grd; g.fillRect(0,0,32,48);
  g.fillStyle='rgba(195,203,110,0.55)';
  for(let y=6;y<48;y+=11) for(let x=(y/11|0)%2?4:12;x<32;x+=8) g.fillRect(x,y,2,2);
  g.fillStyle='rgba(228,230,168,0.16)'; g.fillRect(0,0,32,3);
  wallPat = ctx.createPattern(c,'repeat');

  // Wall top (seen from directly above)
  c = document.createElement('canvas'); c.width=c.height=24;
  g = c.getContext('2d');
  g.fillStyle=PAL.wallTop; g.fillRect(0,0,24,24);
  for(let i=0;i<520;i++){
    g.fillStyle = Math.random()<0.5?'rgba(163,163,112,0.30)':'rgba(214,222,167,0.16)';
    g.fillRect(Math.random()*24, Math.random()*24, 2,2);
  }
  ceilPat = ctx.createPattern(c,'repeat');

  // VHS scanlines: one dark line every four pixels
  c = document.createElement('canvas'); c.width=1; c.height=4;
  g = c.getContext('2d');
  g.fillStyle='rgba(0,0,0,0)'; g.fillRect(0,0,1,4);
  g.fillStyle='rgba(0,0,0,0.28)'; g.fillRect(0,3,1,1);
  scanPat = ctx.createPattern(c,'repeat');
}

/* Builds the film grain: one noise image the size of the screen, drawn once
   per frame. This is much cheaper than tiling a small image about 40 times.

   The canvas is resized and not recreated, since assigning width and height
   clears it just like a new canvas. That matters because the grain is screen
   sized. */
export function buildGrainFull(){
  if (!grainFull) grainFull = document.createElement('canvas');
  /* Zero the old backing store before resizing, so iOS frees it instead of
     holding both the old and the new screen-sized buffer. */
  grainFull.width = 0; grainFull.height = 0;
  grainFull.width = cvs.width; grainFull.height = cvs.height;
  const g = grainFull.getContext('2d');
  const im = g.createImageData(cvs.width, cvs.height);
  for(let i=0;i<im.data.length;i+=4){
    const v = 118 + (Math.random()*74|0);
    im.data[i]=im.data[i+1]=im.data[i+2]=v; im.data[i+3]=255;
  }
  g.putImageData(im,0,0);
}

/* Rebuild the grain only when the canvas size really changed. A resize that
   lands on the same size (a DPR change that rounds the same way, a synthetic
   event, a context restore) would otherwise spend a screen-sized buffer of
   fresh noise to produce an identical picture. */
on('resize', () => {
  if (cvs.width <= 0 || cvs.height <= 0) return;
  if (grainFull && grainFull.width === cvs.width && grainFull.height === cvs.height) return;
  buildGrainFull();
});