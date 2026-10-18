/* The floor, assembled. Everything per-floor is created here: the level itself,
   the G it lives on, and the bakes that fill G — light, images, regions, the
   cast, the room scope, the flood. Nothing below is stateful beyond G. */
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

/* A canvas's bitmap is released when its element is dropped, and every floor
   builds six of them — the two tile layers, the light bake, the mask and the
   packed wet field, the largest at MAP_W*LS square. Five floors in a run is not
   a leak worth measuring, but a floor that is rebuilt on every retry leaves the
   old bitmaps for the GC, and a GC during a frame is a frame the loop has to
   pay for. Zeroing the dimensions is the documented way to release the backing
   store, and it is also honest: a canvas at 0x0 cannot be drawn from, so a stale
   reference fails loudly instead of quietly painting the previous floor. */
export function disposeFloor(g){
  if (!g) return;
  for (const cv of [g.tilesCv, g.wallsCv, g.lightCv, g.maskCv, g.wetCv, g.postCv]){
    if (!cv) continue;
    cv.width = 0; cv.height = 0;
  }
}

export function buildFloor(floorNum, seed){
  /* Before setG, so it is the floor being replaced and not the new one: the
     canvases below are recreated a few lines after this and must not be the
     ones released. */
  disposeFloor(G);

  const rng = mulberry32(seed + floorNum*7919);
  const level = genLevel(rng, floorNum);

  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  /* --- line of sight (Bresenham, walls block) --- */
  const los = makeLos(grid);

  /* The floor object is created HERE, before the bakes below write into it.
     Every per-floor buffer — light, vision, mask, cone, regions, flood — is a
     field of G, so building the next floor replaces them all at once and
     nothing floor-scoped can outlive the floor it describes. The buffers are
     preallocated because the bakes write through G from their first line;
     the fields the placement code decides are assigned after it runs. */
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
    /* The three numbers the HUD and the door gate read, derived once here so
       nothing has to walk the array to answer "is this level finished". */
    leaksOpen: level.leaks.length,
    pipes: level.leaks.length,
    lightArr: new Float32Array(MAP_W*MAP_H),
    lightCv: null, lightCtx: null, lightImg: null,
    visArr: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visFrom: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visTgt: new Float32Array(MAP_W*MAP_H).fill(DARK_ROOM),
    visScratch: new Float32Array(MAP_W*MAP_H),
    maskArr: new Float32Array(MAP_W*MAP_H),
    maskTgt: new Float32Array(MAP_W*MAP_H),
    coneArr: new Float32Array(MAP_W*MAP_H),
    maskCv: null, maskCtx: null, maskImg: null,
    /* Every wall tile, once. The cone's wall pass used to scan all 5776 tiles
       every retrace — which is every frame while moving — to find the walls,
       which on a maze this dense is a few hundred of them. Built here so that
       pass is bounded by the masonry rather than by the map. */
    wallIdx: null,
    /* the static tile layer: carpet + tonal variation, and wall faces + tops.
       Two layers because the flood lands between them. */
    tilesCv: null, tilesCtx: null, wallsCv: null, wallsCtx: null,
    regionOf: new Int32Array(MAP_W*MAP_H).fill(-1),
    regionAdj: null, regionCount: 0,
    visRegion: -1, visStep: 0, visFadeT: 0,
    coneX: NaN, coneY: NaN, coneFace: NaN, coneRadar: null,
    scopeDirty: false,
    wetArr: new Float32Array(MAP_W*MAP_H),
    waterDist: null, wetByDist: [], wetFront: 0, wetMaxDist: 0, wetSum: 0,
    wetEdgeD: -1, wetIndexAtDist: null,
    wetCv: null, wetCtx: null, wetImg: null,
    /* The floor has already been decided — a lifeform has you, or the clock ran
       out. It is a fact about the WORLD rather than about the run (STATE is the
       run's copy), because the simulation is what finds out and the rest of the
       frame has to be told to stop. See update(). */
    ended: false,
    /* THE AGENT STREAM. Its own generator, seeded from the floor, because the
       things that wander the building need randomness and the LEVEL must stay
       reproducible from the seed: a retry hands the player the same pipes in the
       same rooms, and a stream shared with the layout would give them a
       different cast for the same floor. Separate from `rng`, and nothing below
       ever draws from the generator the level was built with. */
    arng: mulberry32((seed ^ 0xA6E27) + floorNum*131),
    dirty: { water: true, mask: true }
  });

  /* The wall index list, before anything reads it. Same row-major order as the
     scan it replaces, so the cone's wall pass writes the same tiles in the same
     order and the resulting field is bit-identical. */
  {
    const idx = [];
    for (let i=0; i<MAP_W*MAP_H; i++) if (grid[i]===WALL) idx.push(i);
    G.wallIdx = Int32Array.from(idx);
  }

  G.lightArr = computeLightArr(level, los);
  attachFloorImages();
  labelRegions(level);
  /* The mask is a SEPARATE canvas at 1 sample per tile rather than another
     term folded into the light bake. It changes every frame the character
     turns, and folding it into the lightmap would mean repacking 116k pixels
     on every small movement instead of 5.8k. */
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
  G.radar = false;
  G.noise = 0; G.noisePeak = 0; G.selfNoise = 0;
  G.descend = 0;
  /* THE CLOCK. Full at the moment you step through the door, counting down
     the whole level, and the only reason the level has a shape. */
  G.clock = FLOOR_CLOCK;
  G.time = 0;
  G.seenBy = 0;
  G.nearest = 99;
  G.stat = { noises:0, deaths:0, sealed:0 };
  /* how many floor tiles the water can ever reach — the denominator for
     "how flooded is this level". Counted from the distance field rather than
     guessed, so it is exactly the set of tiles that can ever go wet. */
  G.wetFloor = 0;
  G.wet = 0; G.floodCover = 0; G.atLeak = false; G.leakPower = 0;
  G.leakTotal = 0; G.leakDist = 99;
  /* Light the room the player spawned in. After this point it follows them:
     G exists, so regionAt(G.player) is meaningful. */
  scopeRoomLight(0, true);
  snapMask();

  initFlood();
  G.gfx = {
    lightCv: G.lightCv, lightCtx: G.lightCtx, lightImg: G.lightImg,
    maskCv: G.maskCv, maskCtx: G.maskCtx, maskImg: G.maskImg,
    tilesCv: G.tilesCv, tilesCtx: G.tilesCtx,
    wallsCv: G.wallsCv, wallsCtx: G.wallsCtx,
    wetCv: G.wetCv, wetCtx: G.wetCtx, wetImg: G.wetImg
  };
}
