/* Builds one floor. Everything that belongs to a single floor is created
   here: the generated level, the G object that holds the floor's state, and
   the pixel layers (light, mask, water, tiles) that the renderer draws. */

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
  if (!g) return;
  for (const cv of [g.tilesCv, g.wallsCv, g.lightCv, g.maskCv, g.wetCv, g.postCv]){
    if (!cv) continue;
    cv.width = 0; cv.height = 0;
  }
}

/**
 * Builds a floor and stores it in G (see sim/state.js).
 *
 * The same seed and floor number always produce the same layout, so a retry
 * puts the pipes in the same rooms.
 *
 * @param {number} floorNum - 0-based floor index; picks the row in LEVELS.
 * @param {number} seed - the run seed.
 */
export function buildFloor(floorNum, seed){
  // Must run before setG, so it releases the old floor and not the new one.
  disposeFloor(G);

  const rng = mulberry32(seed + floorNum*7919);
  const level = genLevel(rng, floorNum);

  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  // Line of sight helper (walls block it)
  const los = makeLos(grid);

  /* Create G before the bakes below, because they write into it. Every
     per-floor buffer (light, vision, mask, regions, flood) is a field of G,
     so building the next floor replaces all of them at once and nothing can
     outlive the floor it describes. Fields that depend on later steps are
     assigned after those steps run. */
  setG({
    floor: floorNum,
    seed,
    grid, at, inB, los,
    rooms: level.rooms,
    exitTiles: level.exit,
    leaks: level.leaks,
    fixtures: level.fixtures,
    batteries: level.batteries,
    graffiti: level.graffiti,
    // Tallies for the HUD and the door: "is this level finished?" without walking the array
    leaksOpen: level.leaks.length,
    pipes: level.leaks.length,
    lightArr: new Float32Array(MAP_W*MAP_H),
    lightCv: null, lightCtx: null, lightImg: null,
    // Visibility layers (see sim/vision.js)
    visArr: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visFrom: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visTgt: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visScratch: new Float32Array(MAP_W*MAP_H),
    maskArr: new Float32Array(MAP_W*MAP_H),
    maskTgt: new Float32Array(MAP_W*MAP_H),
    coneArr: new Float32Array(MAP_W*MAP_H),
    maskCv: null, maskCtx: null, maskImg: null,
    // Indexes of every wall tile, so the vision cone can skip the floor tiles. Filled below.
    wallIdx: null,
    /* Static tile layer: carpet, and wall faces and tops. Two canvases
       because the flood is drawn between them. */
    tilesCv: null, tilesCtx: null, wallsCv: null, wallsCtx: null,
    regionOf: new Int32Array(MAP_W*MAP_H).fill(-1),
    regionAdj: null, regionCount: 0,
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

  // Index of all wall tiles in row order. The vision cone walks this list instead of the whole map.
  {
    const idx = [];
    for (let i=0; i<MAP_W*MAP_H; i++) if (grid[i]===WALL) idx.push(i);
    G.wallIdx = Int32Array.from(idx);
  }

  G.lightArr = computeLightArr(level, los);
  attachFloorImages();
  labelRegions(level);

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

  // Light the room the player starts in. From here on the lit room follows them.
  scopeRoomLight(0, true);
  snapMask();

  initFlood();

  // Handy shortcut to the canvases above, used by the renderer and the tests.
  G.gfx = {
    lightCv: G.lightCv, lightCtx: G.lightCtx, lightImg: G.lightImg,
    maskCv: G.maskCv, maskCtx: G.maskCtx, maskImg: G.maskImg,
    tilesCv: G.tilesCv, tilesCtx: G.tilesCtx,
    wallsCv: G.wallsCv, wallsCtx: G.wallsCtx,
    wetCv: G.wetCv, wetCtx: G.wetCtx, wetImg: G.wetImg
  };
}