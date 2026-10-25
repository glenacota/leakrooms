import { FLOOR, LS, MAP_H, MAP_W, TILE, WALL, WALL_FACE } from '../config/constants.js';
import { hash2 } from '../util/hash.js';
import { G } from '../sim/state.js';
import { carpetPat, ceilPat, wallPat } from './textures.js';

/**
 * Turns the light bake (level.lightArr) into a canvas, and paints the static
 * tile layers. Runs once per floor, from getStaticLevel, and again after a
 * lost graphics context. The canvases are written onto `level`, which is the
 * static level while it is being baked and G when a lost context is rebuilt.
 *
 * Only the ambient light is packed here. Everything that depends on the viewer
 * (room scope, cone of vision, radar) is a separate mask on its own canvas, so
 * there is exactly one multiply, and the mask can only remove light that the
 * bake provides.
 *
 * @param {{grid: Uint8Array, lightArr: Float32Array}} level
 */
export function attachFloorImages(level){
  ensureLightCanvas(level);
  // Canvas size and pixel buffer are looked up once here, because reading them in the loop is slow.
  const LW = level.lightCv.width, LH = level.lightCv.height, LD = level.lightImg.data;
  for (let y=0;y<LH;y++){
    const ty=(y/LS)|0, row=ty*MAP_W;
    for (let x=0;x<LW;x++){
      /* The bake is pure brightness (grey), with no tint. Darkness is the
         mask's job, and the hue comes from the surfaces themselves. */
      const b = Math.min(1, level.lightArr[row + ((x/LS)|0)]);
      const v = Math.round(255*b);
      const k=(y*LW+x)*4;
      LD[k]=v; LD[k+1]=v; LD[k+2]=v;
      LD[k+3] = 255;
    }
  }
  level.lightCtx.putImageData(level.lightImg, 0, 0);

  bakeTiles(level);
}

/**
 * Paints the static tile layers once per floor: the carpet and the wall faces
 * and tops. They depend only on the grid, which never changes while a floor is
 * played, so drawing them again every frame would be about 980 fillRect calls
 * of pixels that never change. Instead they are drawn into two canvases the
 * size of the whole map, and the renderer copies the visible part out with one
 * drawImage each.
 *
 * There are TWO canvases because the flood has to be drawn between the carpet
 * and the wall faces: a partition standing in a flooded room stays dry.
 *
 * The patterns are anchored to the world grid. When they were drawn live, their
 * position followed the camera and the speckles swam as the view moved. Baked,
 * they are part of the building.
 *
 * @param {{grid: Uint8Array}} level
 */
export function bakeTiles(level){
  ensureTilesCanvas(level);
  {
    const g = level.tilesCtx;
    g.setTransform(1,0,0,1,0,0);
    // ---------- Carpet ----------
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

  ensureWallsCanvas(level);
  {
    const g = level.wallsCtx;
    g.setTransform(1,0,0,1,0,0);
    /* ---------- Wall faces and contact shadow ----------
       The face is the vertical side of a partition, drawn into the floor tile
       below the wall. A soft shadow on the carpet under it sells the height, and
       is what makes a top-down maze look like a photographed room and not a
       colour-coded grid. */
    const FACE = WALL_FACE;
    const { grid } = level;
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (grid[y*MAP_W+x]!==WALL) continue;
      if (y+1>=MAP_H || grid[(y+1)*MAP_W+x]!==FLOOR) continue;
      const fx=x*TILE, fy=(y+1)*TILE;

      // Shadow cast onto the carpet
      const sh=g.createLinearGradient(0, fy, 0, fy+TILE*0.5);
      sh.addColorStop(0,'rgba(12,10,4,0.30)');
      sh.addColorStop(1,'rgba(12,10,4,0)');
      g.fillStyle=sh;
      g.fillRect(fx, fy, TILE, TILE*0.5);

      // The wallpapered face
      g.fillStyle = wallPat;
      g.fillRect(fx, fy, TILE, FACE);
      // A hard line where the face meets the ceiling
      g.fillStyle='rgba(40,38,24,0.55)';
      g.fillRect(fx, fy, TILE, 2);
      // A skirting shadow at the base
      g.fillStyle='rgba(48,46,30,0.42)';
      g.fillRect(fx, fy+FACE-2, TILE, 2);
    }

    /* ---------- Wall tops ----------
       Seen from directly above, so they are cooler and clearly darker than the
       carpet. There is no banding on each tile: a lip, edge and seam on every tile
       made a solid wall block look like decking. Edges are only drawn where the
       wall actually meets carpet. */
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (grid[y*MAP_W+x]!==WALL) continue;
      g.fillStyle = ceilPat;
      g.fillRect(x*TILE, y*TILE, TILE, TILE);
    }
    g.fillStyle='rgba(28,26,16,0.55)';
    for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
      if (grid[y*MAP_W+x]!==WALL) continue;
      const below = (y+1<MAP_H && grid[(y+1)*MAP_W+x]===FLOOR);
      if (below){ g.fillRect(x*TILE, y*TILE+TILE-2, TILE, 2); }
      if (x>0      && grid[y*MAP_W+x-1]===FLOOR) g.fillRect(x*TILE, y*TILE, 2, TILE);
      if (x<MAP_W-1 && grid[y*MAP_W+x+1]===FLOOR) g.fillRect(x*TILE+TILE-2, y*TILE, 2, TILE);
      if (y>0      && grid[(y-1)*MAP_W+x]===FLOOR) g.fillRect(x*TILE, y*TILE, TILE, 2);
      if (y<MAP_H-1 && grid[(y+1)*MAP_W+x]===FLOOR) g.fillRect(x*TILE, y*TILE+TILE-2, TILE, 2);
    }
  }
}

/* ---------- Canvas creation (renderer-owned) ---------- */

function ensureLightCanvas(level) {
  // Always create a fresh canvas on attachFloorImages (context restore needs new objects)
  level.lightCv = document.createElement('canvas');
  level.lightCv.width = MAP_W * LS; level.lightCv.height = MAP_H * LS;
  level.lightCtx = level.lightCv.getContext('2d');
  level.lightImg = level.lightCtx.createImageData(level.lightCv.width, level.lightCv.height);
}

function ensureTilesCanvas(level) {
  level.tilesCv = document.createElement('canvas');
  level.tilesCv.width = MAP_W * TILE; level.tilesCv.height = MAP_H * TILE;
  level.tilesCtx = level.tilesCv.getContext('2d');
}

function ensureWallsCanvas(level) {
  level.wallsCv = document.createElement('canvas');
  level.wallsCv.width = MAP_W * TILE; level.wallsCv.height = MAP_H * TILE;
  level.wallsCtx = level.wallsCv.getContext('2d');
}

/**
 * Creates the per-floor canvases (mask, wet) that change every floor.
 * Called from makeFloorState in floor.js.
 */
export function createPerFloorCanvases() {
  G.maskCv = document.createElement('canvas');
  G.maskCv.width = MAP_W; G.maskCv.height = MAP_H;
  G.maskCtx = G.maskCv.getContext('2d');
  G.maskImg = G.maskCtx.createImageData(MAP_W, MAP_H);

  G.wetCv = document.createElement('canvas');
  G.wetCv.width = MAP_W; G.wetCv.height = MAP_H;
  G.wetCtx = G.wetCv.getContext('2d');
  G.wetImg = G.wetCtx.createImageData(MAP_W, MAP_H);
  for (let i=0;i<MAP_W*MAP_H;i++) G.wetImg.data[i*4+3] = 0;
}

/**
 * Releases (zeros) the named canvases from the given object (G or gfx).
 */
export function releaseCanvases(obj, names) {
  if (!obj) return;
  for (const k of names) {
    const cv = obj[k];
    if (!cv) continue;
    cv.width = 0; cv.height = 0;
  }
}

/**
 * Checks if the static canvases are stale (context loss).
 */
export function areStaticCanvasesStale(cached) {
  return !!(G && G.gfx && cached && cached.gfx && G.gfx.tilesCv !== cached.gfx.tilesCv);
}

/**
 * Refreshes static canvases after context loss.
 */
export function refreshStaticCanvases(cached) {
  attachFloorImages(G);
  Object.assign(cached.gfx, {
    tilesCv: G.tilesCv, tilesCtx: G.tilesCtx,
    wallsCv: G.wallsCv, wallsCtx: G.wallsCtx,
    lightCv: G.lightCv, lightCtx: G.lightCtx, lightImg: G.lightImg,
  });
}
