/* Builds one floor. Everything that belongs to a single floor is created
   here: the generated level, the G object that holds the floor's state, and
   the pixel layers (light, mask, water, tiles) that the renderer draws.

   The build is split in two. getStaticLevel() makes the half a building
   decides — the layout, the light bake, the region map and the three painted
   canvases — and holds it for one key (seed and floor number). makeFloorState()
   makes the half a player changes: the flood, the mask, the cast, the clock.

   The split is not tidiness. A retry rebuilds the same floor, so the static
   half is almost always already correct, and regenerating it means running a
   flood fill and repainting 116k pixels to arrive at the same picture. */

import { MAP_H, MAP_W, WALL } from '../config/constants.js';
import { mulberry32 } from '../util/rng.js';
import { makeLos } from '../util/grid.js';
import { genLevel } from '../sim/level.js';
import { labelRegions } from '../sim/regions.js';
import { computeLightArr } from '../sim/lightmap.js';
import { scopeRoomLight, snapMask } from '../sim/vision.js';
import { initFlood } from '../sim/flood.js';
import { G, setG, createGameState } from '../sim/state.js';
import { attachFloorImages } from '../render/bake.js';

/* Every canvas a floor owns, and the subset the cache keeps. The carpet, the
   walls and the light bake are the same pixels for the same building, so a
   retry hands them straight back; the mask and the packed water change with
   the player and are built every time. */
const ALL_CANVASES = ['tilesCv', 'wallsCv', 'lightCv', 'maskCv', 'wetCv', 'postCv'];
const STATIC_CANVASES = ['tilesCv', 'wallsCv', 'lightCv'];
const PER_FLOOR_CANVASES = ['maskCv', 'wetCv', 'postCv'];

/** Zeroes the named canvases of a floor that is being replaced. */
function release(g, names){
  if (!g) return;
  for (const k of names){
    const cv = g[k];
    if (!cv) continue;
    cv.width = 0; cv.height = 0;
  }
}

/**
 * Releases the canvases of a floor that is about to be replaced.
 *
 * Every floor creates six of them. Setting a canvas to 0x0 frees its pixel
 * memory right away instead of leaving it for the garbage collector, which
 * could otherwise run in the middle of a frame. It also means a stale
 * reference fails loudly instead of quietly drawing the old floor.
 *
 * @param {object|null} g - the previous floor's G, or null at first boot.
 */
export function disposeFloor(g){
  release(g, ALL_CANVASES);
}

/* ---------- The cached half ---------- */

let cacheKey = null;
let cache = null;

const keyOf = (seed, floorNum)=> `${seed}:${floorNum}`;

/**
 * The half of a floor that the seed decides and the player never changes:
 * the layout, the light bake, the region map, the wall index and the three
 * static canvases. One entry is held, for one key.
 *
 * Retrying a floor asks for the key it already has and gets the same canvases
 * back. Anything else — a new seed, the next floor — releases them on the way
 * past, so a retired building costs nothing and its pixels are freed rather
 * than left to the collector mid-frame.
 *
 * @param {number} seed - the run seed.
 * @param {number} floorNum - 0-based floor index.
 * @returns {object} the level with its bakes and canvases attached.
 */
export function getStaticLevel(seed, floorNum){
  const key = keyOf(seed, floorNum);
  if (cache && cacheKey === key) return cache;

  if (cache) release(cache.gfx, STATIC_CANVASES);
  cacheKey = key;
  cache = null;

  const level = genLevel(mulberry32(seed + floorNum*7919), floorNum);
  const grid = level.grid;

  // Index of all wall tiles in row order. The vision cone walks this list instead of the whole map.
  const idx = [];
  for (let i=0;i<MAP_W*MAP_H; i++) if (grid[i]===WALL) idx.push(i);

  /* labelRegions() and attachFloorImages() both write through G, so they run
     against a minimal facade holding only what they read. Nothing can observe
     it: this is one synchronous stretch, and the real state is installed over
     it before any of the game's own code runs again. */
  setG({ grid, regionOf: new Int32Array(MAP_W*MAP_H).fill(-1), regionAdj:null, regionCount:0 });
  labelRegions(level);
  const lightArr = computeLightArr(level, makeLos(grid));
  attachFloorImages();

  cache = {
    ...level,
    lightArr,
    wallIdx: Int32Array.from(idx),
    regionOf: G.regionOf, regionAdj: G.regionAdj, regionCount: G.regionCount,
    gfx: {
      tilesCv: G.tilesCv, tilesCtx: G.tilesCtx,
      wallsCv: G.wallsCv, wallsCtx: G.wallsCtx,
      lightCv: G.lightCv, lightCtx: G.lightCtx, lightImg: G.lightImg,
    },
  };
  return cache;
}

/* ---------- The floor's own state ---------- */

/**
 * Builds a floor on top of a static bake: everything a player can change is
 * made new, and the arrays play mutates are cloned out of the cache so a
 * played floor cannot mark the building it came from.
 *
 * @param {object} level - the static level from getStaticLevel().
 * @param {number} floorNum - 0-based floor index.
 * @param {number} seed - the run seed.
 */
export function makeFloorState(level, floorNum, seed){
  setG(createGameState(level, floorNum, seed));

  /* The visibility mask is its own canvas at one pixel per tile. It changes
     whenever the player turns, so keeping it separate from the light bake
     means repacking 5.8k pixels instead of 116k. */
  G.maskCv = document.createElement('canvas');
  G.maskCv.width = MAP_W; G.maskCv.height = MAP_H;
  G.maskCtx = G.maskCv.getContext('2d');
  G.maskImg = G.maskCtx.createImageData(MAP_W, MAP_H);
  G.wetCv = document.createElement('canvas');
  G.wetCv.width = MAP_W; G.wetCv.height = MAP_H;
  G.wetCtx = G.wetCv.getContext('2d');
  G.wetImg = G.wetCtx.createImageData(MAP_W, MAP_H);
  for (let i=0;i<MAP_W*MAP_H;i++) G.wetImg.data[i*4+3] = 0;

  // Handy shortcut to the canvases above, used by the renderer and the tests.
  G.gfx = {
    lightCv: G.lightCv, lightCtx: G.lightCtx, lightImg: G.lightImg,
    maskCv: G.maskCv, maskCtx: G.maskCtx, maskImg: G.maskImg,
    tilesCv: G.tilesCv, tilesCtx: G.tilesCtx,
    wallsCv: G.wallsCv, wallsCtx: G.wallsCtx,
    wetCv: G.wetCv, wetCtx: G.wetCtx, wetImg: G.wetImg
  };

  /* A graphics context loss replaces the canvases without changing the level
     (see ui/bind.js), so the cached ones can be dead while the key still
     matches. buildFloor re-bakes them and hands the fresh ones back. */

  // Light the room the player starts in. From here on the lit room follows them.
  scopeRoomLight(0, true);
  snapMask();

  initFlood();
}

/**
 * Builds a floor and stores it in G (see sim/state.js).
 *
 * The same seed and floor number always produce the same layout, so a retry
 * puts the pipes in the same rooms — and now hands back the same canvases too.
 *
 * @param {number} floorNum - 0-based floor index; picks the row in LEVELS.
 * @param {number} seed - the run seed.
 */
export function buildFloor(floorNum, seed){
  const key = keyOf(seed, floorNum);
  const cached = cache && cacheKey === key;
  /* A context loss swapped the canvases out from under the cache since it was
     filled. Decided before G is replaced, because that is what it compares. */
  const staleImages = cached && G && G.gfx && G.gfx.tilesCv !== cache.gfx.tilesCv;

  /* Must run before the new state is stored in G, so it releases the old floor
     and not the new one. On a cache hit the three static canvases are the NEW
     floor's canvases as well, so only the per-floor ones are released. */
  if (cached) release(G, PER_FLOOR_CANVASES); else disposeFloor(G);

  makeFloorState(getStaticLevel(seed, floorNum), floorNum, seed);

  /* The level is the same one the cache holds, but its pixels are not: a
     graphics context loss replaced them (see ui/bind.js). Bake again and put
     the fresh canvases back in the cache, so restoring the dead ones is not
     what the NEXT retry gets either. */
  if (staleImages){
    attachFloorImages();
    Object.assign(cache.gfx, {
      tilesCv: G.tilesCv, tilesCtx: G.tilesCtx,
      wallsCv: G.wallsCv, wallsCtx: G.wallsCtx,
      lightCv: G.lightCv, lightCtx: G.lightCtx, lightImg: G.lightImg,
    });
    Object.assign(G.gfx, {
      tilesCv: G.tilesCv, tilesCtx: G.tilesCtx,
      wallsCv: G.wallsCv, wallsCtx: G.wallsCtx,
      lightCv: G.lightCv, lightCtx: G.lightCtx, lightImg: G.lightImg,
    });
  }
}