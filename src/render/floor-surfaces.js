/* ============================================================
   FLOOR SURFACES
   The five canvases a floor draws from, and nothing else writes to them:

     tiles, walls   the carpet and the wall faces and tops. Painted once per
                    building, cached by its key, so a retry repaints nothing.
     light          the ambient light bake. Also cached by key.
     mask           what the plumber can see right now. New on every build.
     wet            the water, one pixel per tile. New on every build.

   Callers read the canvases through `surfaces` at draw time and never hold
   one across frames: a context restore replaces them.

   Pixel inputs are passed in (a grid and a light array for the bake, and
   {grid, wetArr, maskArr} for the packers), so this module does not import
   the simulation state.
   ============================================================ */

import { FACE_BACKLIGHT, FLOOR, LS, MAP_H, MAP_W, TILE, VISION_PENUMBRA_TILES, WALL, WALL_FACE, WET_DRAW } from '../config/constants.js';
import { WATER_TINTS } from '../config/presets.js';
import { SETTINGS } from '../settings/store.js';
import { hash2 } from '../util/hash.js';
import { on } from '../util/events.js';
import { markWetAll, markWetTile, repaintDirty, takeWetBox } from '../util/repaint.js';
import { buildGrainFull, buildPatterns, carpetPat, ceilPat, wallPat } from './textures.js';

/* The renderer owns the dirty box. Sim announces what changed through events,
   and this module turns those announcements into dirty flags and a dirty box. */
on('tileChanged', markWetTile);
on('waterChanged', markWetAll);
on('maskChanged', () => { repaintDirty.mask = true; });

/* The packers check this, so a headless test skips the pixel work. */
let wantPixels = true;

/**
 * Turns the per-frame packing on or off. Off in headless tests, which read the
 * simulation arrays and never the images.
 *
 * @param {boolean} v
 */
export function setPixels(v){ wantPixels = !!v; }

/* The static half, cached for one key. `key` is the floor whose static three
   are ready; it is null while a bake runs or after one failed. `wantKey` is the
   floor that was asked for, and it survives a failed bake so a restore can
   retry it. `grid` and `lightArr` are kept so a restore can bake again without
   asking anyone for them. */
const staticHalf = {
  key: null, wantKey: null, grid: null, lightArr: null,
  tilesCv: null, tilesCtx: null,
  wallsCv: null, wallsCtx: null,
  lightCv: null, lightCtx: null, lightImg: null,
};

/* The per-floor half, new on every build. */
const perBuild = {
  maskCv: null, maskCtx: null, maskImg: null,
  wetCv: null, wetCtx: null, wetImg: null,
};

/* Each read returns the canvas and throws before a floor is built. */
function requireCanvas(cv){
  if (!cv) throw new Error('floor surfaces: no floor built');
  return cv;
}

/**
 * The five pixel surfaces a floor draws from. Read them at draw time and never
 * hold one across frames, because a context restore replaces them. Each getter
 * throws before the first floor is built.
 *
 * @type {Readonly<{tiles: HTMLCanvasElement, walls: HTMLCanvasElement,
 *   light: HTMLCanvasElement, mask: HTMLCanvasElement, wet: HTMLCanvasElement}>}
 */
export const surfaces = Object.freeze({
  get tiles(){ return requireCanvas(staticHalf.tilesCv); },
  get walls(){ return requireCanvas(staticHalf.wallsCv); },
  get light(){ return requireCanvas(staticHalf.lightCv); },
  get mask(){ return requireCanvas(perBuild.maskCv); },
  get wet(){ return requireCanvas(perBuild.wetCv); },
});

/* A released canvas keeps its element but has no pixels, so a draw from it
   paints nothing and does not throw. */
function release(cv){
  if (cv){ cv.width = 0; cv.height = 0; }
}

/* A wall face is the south side of a wall tile with floor below it. The bake
   paints it, and the mask lights it. The row comes from the index. */
function isWallFace(grid, idx){
  const row = (idx / MAP_W) | 0;
  return grid[idx]===WALL && row+1<MAP_H && grid[idx+MAP_W]===FLOOR;
}

/* ---------- Static half ---------- */

function ensureLightCanvas(){
  staticHalf.lightCv = document.createElement('canvas');
  staticHalf.lightCv.width = MAP_W * LS; staticHalf.lightCv.height = MAP_H * LS;
  staticHalf.lightCtx = staticHalf.lightCv.getContext('2d');
  staticHalf.lightImg = staticHalf.lightCtx.createImageData(staticHalf.lightCv.width, staticHalf.lightCv.height);
}

function ensureTilesCanvas(){
  staticHalf.tilesCv = document.createElement('canvas');
  staticHalf.tilesCv.width = MAP_W * TILE; staticHalf.tilesCv.height = MAP_H * TILE;
  staticHalf.tilesCtx = staticHalf.tilesCv.getContext('2d');
}

function ensureWallsCanvas(){
  staticHalf.wallsCv = document.createElement('canvas');
  staticHalf.wallsCv.width = MAP_W * TILE; staticHalf.wallsCv.height = MAP_H * TILE;
  staticHalf.wallsCtx = staticHalf.wallsCv.getContext('2d');
}

/* Bakes the ambient light and the static tile layers from staticHalf.grid and
   staticHalf.lightArr. The light is pure brightness: darkness belongs to the mask, and
   the hue comes from the surfaces. */
function bakeStatic(){
  ensureLightCanvas();
  const LW = staticHalf.lightCv.width, LH = staticHalf.lightCv.height, LD = staticHalf.lightImg.data;
  for (let y=0;y<LH;y++){
    const ty=(y/LS)|0, row=ty*MAP_W;
    for (let x=0;x<LW;x++){
      const b = Math.min(1, staticHalf.lightArr[row + ((x/LS)|0)]);
      const v = Math.round(255*b);
      const k=(y*LW+x)*4;
      LD[k]=v; LD[k+1]=v; LD[k+2]=v;
      LD[k+3] = 255;
    }
  }
  staticHalf.lightCtx.putImageData(staticHalf.lightImg, 0, 0);
  bakeTiles();
}

/* The carpet, the wall faces and the wall tops, drawn once per building. There
   are two canvases because the flood is drawn between them: a partition in a
   flooded room stays dry. The patterns are anchored to the world grid, so they
   are part of the building and do not swim with the camera. */
function bakeTiles(){
  ensureTilesCanvas();
  {
    const g = staticHalf.tilesCtx;
    g.setTransform(1,0,0,1,0,0);
    // Carpet
    g.fillStyle = carpetPat;
    g.fillRect(0, 0, MAP_W*TILE, MAP_H*TILE);
    // A little random tonal variation on some tiles
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      const h=hash2(x,y);
      if (h<0.14){
        g.fillStyle = h<0.05 ? 'rgba(163,163,112,0.16)' : 'rgba(228,230,168,0.10)';
        g.fillRect(x*TILE, y*TILE, TILE, TILE);
      }
    }
  }

  ensureWallsCanvas();
  {
    const g = staticHalf.wallsCtx;
    const { grid } = staticHalf;
    g.setTransform(1,0,0,1,0,0);
    const FACE = WALL_FACE;
    /* Wall tops, seen from directly above: cooler and darker than the carpet.
       Edges are drawn only where a wall meets carpet, not on every tile. */
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (grid[y*MAP_W+x]!==WALL) continue;
      g.fillStyle = ceilPat;
      g.fillRect(x*TILE, y*TILE, TILE, TILE);
    }
    g.fillStyle='rgba(28,26,16,0.55)';
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (grid[y*MAP_W+x]!==WALL) continue;
      if (x>0      && grid[y*MAP_W+x-1]===FLOOR) g.fillRect(x*TILE, y*TILE, 2, TILE);
      if (x<MAP_W-1 && grid[y*MAP_W+x+1]===FLOOR) g.fillRect(x*TILE+TILE-2, y*TILE, 2, TILE);
      if (y>0      && grid[(y-1)*MAP_W+x]===FLOOR) g.fillRect(x*TILE, y*TILE, TILE, 2);
    }

    /* Wall faces: the vertical side of a partition, drawn into the bottom of the
       wall tile and never into the floor tile below, so the plumber's feet stay
       on carpet. A soft shadow on the carpet sells the height. */
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (!isWallFace(grid, y*MAP_W+x)) continue;
      const wx=x*TILE, wy=(y+1)*TILE - FACE;
      const fy=(y+1)*TILE;

      // Shadow cast onto the carpet
      const sh=g.createLinearGradient(0, fy, 0, fy+TILE*0.5);
      sh.addColorStop(0,'rgba(12,10,4,0.20)');
      sh.addColorStop(1,'rgba(12,10,4,0)');
      g.fillStyle=sh;
      g.fillRect(wx, fy, TILE, TILE);

      // The wallpapered face
      g.fillStyle = wallPat;
      g.fillRect(wx, wy, TILE, FACE);
      // A hard line where the face meets the ceiling
      g.fillStyle='rgba(40,38,24,0.55)';
      g.fillRect(wx, wy, TILE, 2);
      // A skirting shadow at the base
      g.fillStyle='rgba(48,46,30,0.22)';
      g.fillRect(wx, fy, TILE, 2);
    }
  }
}

/* ---------- Per-floor half ---------- */

/* Makes the mask and the water for a new floor, and releases the pair they
   replace. createImageData starts at zero, so the water starts fully
   transparent without a fill. */
function openFloorCanvases(){
  release(perBuild.maskCv);
  release(perBuild.wetCv);

  perBuild.maskCv = document.createElement('canvas');
  perBuild.maskCv.width = MAP_W; perBuild.maskCv.height = MAP_H;
  perBuild.maskCtx = perBuild.maskCv.getContext('2d');
  perBuild.maskImg = perBuild.maskCtx.createImageData(MAP_W, MAP_H);

  perBuild.wetCv = document.createElement('canvas');
  perBuild.wetCv.width = MAP_W; perBuild.wetCv.height = MAP_H;
  perBuild.wetCtx = perBuild.wetCv.getContext('2d');
  perBuild.wetImg = perBuild.wetCtx.createImageData(MAP_W, MAP_H);
}

/* ---------- Building ---------- */

/**
 * Makes the surfaces for one floor. The same key keeps the static three; a
 * new key releases them and bakes new ones. The mask and the water are always
 * new.
 *
 * @param {string} key - the building's identity, 'seed:floor'.
 * @param {{grid: Uint8Array, lightArr: Float32Array}} inputs
 */
export function buildFloorSurfaces(key, inputs){
  if (!inputs || !inputs.grid || !inputs.lightArr)
    throw new TypeError('buildFloorSurfaces needs the grid and the light array');

  if (key !== staticHalf.key){
    staticHalf.grid = inputs.grid;
    staticHalf.lightArr = inputs.lightArr;
    staticHalf.wantKey = key;
    rebakeStatic(key);
  }
  openFloorCanvases();
}

/* Releases the old static three and bakes them again. The ready key is cleared
   first and set only after the bake, so a bake that throws leaves nothing that
   looks ready. Both the build and the context restore go through here. */
function rebakeStatic(key){
  staticHalf.key = null;
  release(staticHalf.tilesCv); release(staticHalf.wallsCv); release(staticHalf.lightCv);
  bakeStatic();
  staticHalf.key = key;
}

/* ---------- Per frame ---------- */

/* Packs the water into the packed image, one pixel per tile. It is a tint over
   the carpet, not an opaque fill, so a wet tile reads as the same carpet under
   water and not as a blue card. Dry tiles get alpha 0, never opaque black, or
   they would paint over the carpet.

   Only the box of tiles that changed is rewritten and uploaded: with a leak
   open the water moves every frame, but only in a thin band.

   The image is drawn scaled up with smoothing, and that is not cosmetic: at one
   pixel per tile a hard waterline would crawl along the tile grid. Bilinear
   scaling softens the front into an irregular edge at no per-frame cost.

   The colour ramp blends between the two ends of the chosen tint (WATER_TINTS).
   The ends were picked by looking at the finished tile over the carpet.
   Colours that look like water on their own gave glowing ice, or a dark tone
   that could not be told from an unlit floor, which breaks the mechanic. */
function packWet(sim){
  const T = WATER_TINTS[SETTINGS.waterHue] || WATER_TINTS.slate;
  const contrast = SETTINGS.waterContrast;
  const d = perBuild.wetImg.data;
  const { x0, y0, x1, y1 } = takeWetBox();
  for (let y=y0; y<=y1; y++){
    let i = y*MAP_W + x0;
    for (let x=x0; x<=x1; x++, i++){
      const a = sim.wetArr[i];
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
  perBuild.wetCtx.putImageData(perBuild.wetImg, 0, 0, x0, y0, w, h);
}

/* Packs the visibility mask. It is a pure brightness gate, so it is grey only. */
function packMask(sim){
  const d = perBuild.maskImg.data;
  const { maskArr, grid } = sim;
  /* A one-sided smoothstep feather across VISION_PENUMBRA_TILES. A lit tile
     next to a darker one is dimmed toward it; darkness bleeds into light, not
     the other way round. Wall faces are exempt from dimming by the interior of
     their own block, and the interior gets FACE_BACKLIGHT from the face so a
     face you look at is not blended toward black by the upscale. */
  const interior = j => grid[j]===WALL && !isWallFace(grid, j);
  let i = 0;
  for (let y=0; y<MAP_H; y++){
    for (let x=0; x<MAP_W; x++, i++){
      const v = maskArr[i];
      let out = v;
      const face = isWallFace(grid, i);
      if (v > 0){
        // Darkest orthogonal neighbour: only a darker neighbour can dim this tile.
        let nmin = v;
        if (x > 0       && maskArr[i-1]     < nmin && !(face && interior(i-1)))     nmin = maskArr[i-1];
        if (x+1 < MAP_W && maskArr[i+1]     < nmin && !(face && interior(i+1)))     nmin = maskArr[i+1];
        if (y > 0       && maskArr[i-MAP_W] < nmin && !(face && interior(i-MAP_W))) nmin = maskArr[i-MAP_W];
        if (y+1 < MAP_H && maskArr[i+MAP_W] < nmin) nmin = maskArr[i+MAP_W];
        if (nmin < v){
          const gap = v - nmin;                 // how much brighter than the darkest neighbour
          const s = gap*gap*(3 - 2*gap);        // smoothstep falloff across the penumbra
          // Spread across VISION_PENUMBRA_TILES: at width 1 the edge sits at 0.5 and is dimmed by up to half.
          out = v * (1 - s * (0.5 / VISION_PENUMBRA_TILES));
        }
      }
      if (grid[i]===WALL && !face){
        let lit = 0;
        if (x > 0       && isWallFace(grid, i-1))       lit = Math.max(lit, maskArr[i-1]);
        if (x+1 < MAP_W && isWallFace(grid, i+1))       lit = Math.max(lit, maskArr[i+1]);
        if (y+1 < MAP_H && isWallFace(grid, i+MAP_W)) lit = Math.max(lit, maskArr[i+MAP_W]);
        if (lit*FACE_BACKLIGHT > out) out = lit*FACE_BACKLIGHT;
      }
      const b = Math.min(255, out * 255);
      const k = i*4;
      d[k]=b; d[k+1]=b; d[k+2]=b; d[k+3]=255;
    }
  }
  perBuild.maskCtx.putImageData(perBuild.maskImg, 0, 0);
}

/**
 * Packs whatever the simulation has changed since the last frame. Called once
 * at the top of render(), before any pass draws.
 *
 * @param {{grid: Uint8Array, wetArr: Float32Array, maskArr: Float32Array}} sim
 */
export function syncSurfaces(sim){
  /* Headless: leave the dirty flags pending, so the first packed frame after
     setPixels(true) still draws what changed. */
  if (!staticHalf.key || !wantPixels) return;
  if (repaintDirty.water){ packWet(sim); repaintDirty.water = false; }
  if (repaintDirty.mask){ packMask(sim); repaintDirty.mask = false; }
}

/* ---------- Context loss ---------- */

/* A lost context takes every bitmap with it. Textures come first, because the
   bake paints with them. Then the static half is staticHalf again from the inputs
   the module kept, and the floor's canvases are renewed. Nothing reads G. */
function restore(){
  buildPatterns();
  buildGrainFull();
  /* The wanted key, not the ready one: a bake that failed on an earlier restore
     or build left the ready key clear, and this restore must still bake again. */
  if (!staticHalf.wantKey) return;
  rebakeStatic(staticHalf.wantKey);
  openFloorCanvases();
  repaintDirty.water = true;
  repaintDirty.mask = true;
  markWetAll();
}

let listening = false;

/**
 * Subscribes to the graphics context restore. Called once from boot.
 */
export function bindFloorSurfaces(){
  if (listening) return;
  listening = true;
  on('contextrestored', restore);
}
