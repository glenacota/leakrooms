/* ============================================================
   STATE DOMAINS
   One factory per domain object behind the G facade (see state.js, which owns
   the key ownership map). Each factory builds a plain object and touches no
   canvas.
   ============================================================ */

import { BATT_MAX, DARK_ROOM, MAP_H, MAP_W, WALL } from '../config/constants.js';
import { FLOOR_CLOCK } from '../config/tuning.js';
import { makeLos } from '../util/grid.js';
import { mulberry32 } from '../util/rng.js';
import { spawnLifeforms } from './spawn.js';

/**
 * LevelState — static geometry + region data + floor/seed.
 * Never changes after the floor is built.
 */
export function createLevelState(level, floorNum, seed) {
  const grid = level.grid;
  const at = (x, y) => grid[y * MAP_W + x];
  const inB = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const los = makeLos(grid);

  // Index of all wall tiles in row order (for vision cone)
  const wallIdx = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) if (grid[i] === WALL) wallIdx.push(i);

  return {
    floor: floorNum,
    seed,
    grid,
    at,
    inB,
    los,
    rooms: level.rooms,
    exitTiles: level.exit.map(e => ({ ...e })),
    fixtures: level.fixtures,
    batteries: level.batteries.map(b => ({ ...b })),
    graffiti: level.graffiti.map(g => ({ ...g })),
    lightArr: level.lightArr,
    lightCv: level.gfx.lightCv,
    lightCtx: level.gfx.lightCtx,
    lightImg: level.gfx.lightImg,
    wallIdx: Int32Array.from(wallIdx),
    tilesCv: level.gfx.tilesCv,
    tilesCtx: level.gfx.tilesCtx,
    wallsCv: level.gfx.wallsCv,
    wallsCtx: level.gfx.wallsCtx,
    regionOf: level.regionOf,
    regionAdj: level.regionAdj,
    regionCount: level.regionCount,
  };
}

/**
 * LeakState — per-pipe mutable fields + leaksOpen/pipes.
 * The leaks array is cloned from the level so each floor owns its copy.
 */
export function createLeakState(level) {
  const leaks = level.leaks.map(L => ({ ...L }));
  return {
    leaks,
    leaksOpen: level.leaks.length,
    pipes: level.leaks.length,
  };
}

/**
 * PlumberState — plumber, batt, radar, radarRattleT.
 */
export function createPlumberState(level) {
  return {
    plumber: { x: level.spawn.x, y: level.spawn.y, face: -Math.PI / 2, stepT: 0, stepDur: 0.46, moving: false },
    batt: BATT_MAX,
    radar: false,
    radarRattleT: 0,
  };
}

/**
 * LifeformState — lifeforms, seenBy, nearest, arng, floor (for speed).
 */
export function createLifeformState(level, seed, floorNum) {
  // Use a dedicated RNG stream for lifeform placement, separate from the layout RNG.
  // This makes the cast reproducible on retry regardless of how much the layout
  // RNG was consumed during level generation. The constants are arbitrary but fixed.
  const lifeformRng = mulberry32((seed ^ 0xC01) + floorNum * 131);
  return {
    lifeforms: spawnLifeforms(level, lifeformRng),
    seenBy: 0,
    nearest: 99,
    arng: mulberry32((seed ^ 0xA6E27) + floorNum * 131),
  };
}

/**
 * FloodState — wet arrays + floodCover.
 * Dirty tracking lives in util/repaint.js.
 */
export function createFloodState() {
  return {
    wetArr: new Float32Array(MAP_W * MAP_H),
    waterDist: null,
    wetByDist: [],
    wetFront: 0,
    wetMaxDist: 0,
    wetSum: 0,
    wetEdgeD: -1,
    wetIndexAtDist: null,
    wetCv: null,
    wetCtx: null,
    wetImg: null,
    wetFloor: 0,
    floodCover: 0,
  };
}

/**
 * VisionState — vis/mask/cone arrays + visRegion/Step/FadeT + coneX/Y/Face/Radar + scopeDirty.
 * wantVision is a module-level flag in vision.js, not stored here.
 */
export function createVisionState() {
  return {
    visArr: new Float32Array(MAP_W * MAP_H).fill(DARK_ROOM),
    visFrom: new Float32Array(MAP_W * MAP_H).fill(DARK_ROOM),
    visTgt: new Float32Array(MAP_W * MAP_H).fill(DARK_ROOM),
    visScratch: new Float32Array(MAP_W * MAP_H),
    maskArr: new Float32Array(MAP_W * MAP_H),
    maskTgt: new Float32Array(MAP_W * MAP_H),
    coneArr: new Float32Array(MAP_W * MAP_H),
    maskCv: null,
    maskCtx: null,
    maskImg: null,
    visRegion: -1,
    visStep: 0,
    visFadeT: 0,
    coneX: NaN,
    coneY: NaN,
    coneFace: NaN,
    coneRadar: null,
    scopeDirty: false,
  };
}

/**
 * NoiseState — noise meters + stat.
 */
export function createNoiseState() {
  return {
    noise: 0,
    noisePeak: 0,
    selfNoise: 0,
    ambientNoise: 0,
    stat: { noises: 0, deaths: 0, sealed: 0 },
  };
}

/**
 * ClockState — time/clock/clockAnnounced.
 */
export function createClockState() {
  return {
    time: 0,
    clock: FLOOR_CLOCK,
    clockAnnounced: false,
  };
}

/**
 * DoorState — descend/ended/wet/atLeak/leakPower/Total/Dist.
 */
export function createDoorState() {
  return {
    descend: 0,
    ended: false,
    wet: 0,
    atLeak: false,
    leakPower: 0,
    leakTotal: 0,
    leakDist: 99,
  };
}
