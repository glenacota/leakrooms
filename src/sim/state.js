import { BATT_MAX, DARK_ROOM, MAP_H, MAP_W } from '../config/constants.js';
import { FLOOR_CLOCK } from '../config/tuning.js';
import { mulberry32 } from '../util/rng.js';
import { makeLos } from '../util/grid.js';
import { spawnAgents } from './spawn.js';

/* All the state of the current floor lives behind G. No state exists until
   the first buildFloor() call, and buildFloor() replaces it completely, so
   nothing that belongs to a floor can outlive that floor. Every module reads
   the floor through G.

   G is a facade, not the state itself. Every G.<field> read or write is
   forwarded to the object behind it, so a retry can install a whole new floor
   while every reader keeps the same G reference. The facade also keeps the
   floor's keys enumerable, so Object.keys(G) still lists exactly what a built
   floor owns. */
let gameState = null;

export const G = new Proxy({}, {
  get(_, k){ return gameState ? gameState[k] : undefined; },
  set(_, k, v){ if (gameState) gameState[k] = v; return true; },
  has(_, k){ return gameState ? k in gameState : false; },
  ownKeys(){ return gameState ? Reflect.ownKeys(gameState) : []; },
  getOwnPropertyDescriptor(_, k){
    return gameState ? Reflect.getOwnPropertyDescriptor(gameState, k) : undefined;
  },
});

/** Installs a floor's state behind the facade. */
export function setG(g){ gameState = g; }

/* The floor's own state. Pure: it allocates arrays and clones the level's
   mutable parts, and touches no canvas. The canvases and the G-dependent
   ticks are finished by game/floor.js, which owns the render side. */
export function createGameState(level, floorNum, seed){
  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  // Line of sight helper (walls block it)
  const los = makeLos(grid);

  const leaks = level.leaks.map(L => ({ ...L }));

  /* Every per-floor buffer (vision, mask, flood) is a field of the state, so
     building the next floor replaces all of them at once and nothing can
     outlive the floor it describes. The static half comes in whole: same
     lightArr, same region map, same three canvases. */
  return {
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
    dirty: { water: true, mask: true },
    agents: spawnAgents(level),
    player: { x: level.spawn.x, y: level.spawn.y, face:-Math.PI/2, stepT:0, stepDur:0.46, moving:false },
    batt: BATT_MAX,
    radar: false, radarRattleT: 0,
    noise: 0, noisePeak: 0, selfNoise: 0, ambientNoise: 0,
    descend: 0,
    // The level clock starts full when the player steps in.
    clock: FLOOR_CLOCK,
    time: 0,
    seenBy: 0,
    nearest: 99,
    stat: { noises:0, deaths:0, sealed:0 },
    // Counted by initFlood: how many floor tiles the water can ever reach.
    wetFloor: 0,
    wet: 0, floodCover: 0, atLeak: false, leakPower: 0,
    leakTotal: 0, leakDist: 99,
  };
}
