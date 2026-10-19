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

import { BATT_MAX, DARK_ROOM, FLOOR, MAP_H, MAP_W, WALL } from '../config/constants.js';
import { FLOOR_CLOCK } from '../config/tuning.js';
import { mulberry32 } from '../util/rng.js';
import { makeLos } from '../util/grid.js';
import { genLevel } from '../sim/level.js';
import { labelRegions } from '../sim/regions.js';
import { computeLightArr } from '../sim/lightmap.js';
import { spawnAgents } from '../sim/spawn.js';
import { scopeRoomLight, snapMask } from '../sim/vision.js';
import { initFlood } from '../sim/flood.js';
import { G, setG } from '../sim/state.js';
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
     against a scratch G holding only what they read. Nothing can observe it:
     this is one synchronous stretch, and the real G is installed over it before
     any of the game's own code runs again. */
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
  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  // Line of sight helper (walls block it)
  const los = makeLos(grid);

  const leaks = level.leaks.map(L => ({ ...L }));

  /* Every per-floor buffer (vision, mask, flood) is a field of G, so building
     the next floor replaces all of them at once and nothing can outlive the
     floor it describes. The static half comes in whole: same lightArr, same
     region map, same three canvases. */
  setG({
    floor: floorNum,
    seed,
    grid, at, inB, los,
    rooms: level.rooms,
    exitTiles: level.exit.map(e => ({ ...e })),
    leaks,
    fixtures: level.fixtures,
    batteries: level.batteries.map(b => ({ ...b })),
    graffiti: level.graffiti.map(g => ({ ...g })),
    // Tallies for the HUD and the door: "is this level finished?" without walking the array
    leaksOpen: level.leaks.length,
    pipes: level.leaks.length,
    lightArr: level.lightArr,
    lightCv: level.gfx.lightCv, lightCtx: level.gfx.lightCtx, lightImg: level.gfx.lightImg,
    // Visibility layers (see sim/vision.js)
    visArr: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visFrom: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visTgt: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visScratch: new Float32Array(MAP_W*MAP_H),
    maskArr: new Float32Array(MAP_W*MAP_H),
    maskTgt: new Float32Array(MAP_W*MAP_H),
    coneArr: new Float32Array(MAP_W*MAP_H),
    maskCv: null, maskCtx: null, maskImg: null,
    // Index of every wall tile, so the vision cone can skip the floor tiles.
    wallIdx: level.wallIdx,
    /* Static tile layer: carpet, and wall faces and tops. Two canvases
       because the flood is drawn between them. */
    tilesCv: level.gfx.tilesCv, tilesCtx: level.gfx.tilesCtx,
    wallsCv: level.gfx.wallsCv, wallsCtx: level.gfx.wallsCtx,
    regionOf: level.regionOf, regionAdj: level.regionAdj, regionCount: level.regionCount,
    visRegion: -1, visStep: 0, visFadeT: 0,
    coneX: NaN, coneY: NaN, coneFace: NaN, coneRadar: null,
    scopeDirty: false,
    // Flood state (see sim/flood.js)
    wetArr: new Float32Array(MAP_W*MAP_H),
    waterDist: null, wetByDist: [], wetFront: 0, wetMaxDist: 0, wetSum: 0,
    wetEdgeD: -1, wetIndexAtDist: null,
    wetCv: null, wetCtx: null, wetImg: null,
    /* True once this floor has been decided (a lifeform caught you, or the
       clock ran out). update() checks it so the rest of the frame stops. */
    ended: false,
    /* Random stream for the lifeforms. It is separate from the level's own
       generator on purpose: the layout must be reproducible from the seed, and
       sharing one stream would change the cast whenever the layout code
       changed. Nothing below draws from the level's generator. */
    arng: mulberry32((seed ^ 0xA6E27) + floorNum*131),
    // Pixel layers that need repacking before the next draw
    dirty: { water: true, mask: true }
  });

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
  G.agents = spawnAgents(level);
  G.player = { x: level.spawn.x, y: level.spawn.y, face:-Math.PI/2, stepT:0, stepDur:0.46, moving:false };
  G.batt = BATT_MAX;
  G.radar = false; G.radarRattleT = 0;
  G.noise = 0; G.noisePeak = 0; G.selfNoise = 0; G.ambientNoise = 0;
  G.descend = 0;
  // The level clock starts full when the player steps in.
  G.clock = FLOOR_CLOCK;
  G.time = 0;
  G.seenBy = 0;
  G.nearest = 99;
  G.stat = { noises:0, deaths:0, sealed:0 };
  // Counted by initFlood below: how many floor tiles the water can ever reach.
  G.wetFloor = 0;
  G.wet = 0; G.floodCover = 0; G.atLeak = false; G.leakPower = 0;
  G.leakTotal = 0; G.leakDist = 99;

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