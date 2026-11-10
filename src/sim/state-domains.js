/* ============================================================
   STATE DOMAINS
   One factory per domain object behind the G facade.
   ============================================================ */

import { BATT_MAX, DARK_ROOM, MAP_H, MAP_W, WALL } from '../config/constants.js';
import { FLOOR_CLOCK } from '../config/tuning.js';
import { makeLos } from '../util/grid.js';
import { mulberry32 } from '../util/rng.js';
import { spawnLifeforms } from './spawn.js';

/**
 * LevelState — geometry and region data that the layout fixes, plus floor/seed.
 * The grid, rooms and regions are shared with the level cache and never change.
 * exitTiles, batteries and notes are cloned so each floor can open, take or read
 * them without touching the cached level.
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
    notes: level.notes.map(n => ({ ...n })),
    loreRng: mulberry32((seed ^ 0x4B7F) + floorNum * 173),
    lightArr: level.lightArr,
    wallIdx: Int32Array.from(wallIdx),
    regionOf: level.regionOf,
    regionAdj: level.regionAdj,
    regionCount: level.regionCount,
  };
}

/**
 * LeakState — per-pipe mutable fields and the noise the leaks make.
 * The leaks array is cloned from the level so each floor owns its copy.
 * leakPower, leakTotal and leakDist are recomputed each step by sim/leaks.js;
 * atLeak says whether the plumber is standing at a standing spot.
 */
export function createLeakState(level) {
  const leaks = level.leaks.map(L => ({ ...L }));
  return {
    leaks,
    openLeaks: level.leaks.length,
    totalLeaks: level.leaks.length,
    atLeak: false,
    leakPower: 0,
    leakTotal: 0,
    leakDist: 99,
  };
}

/**
 * PlumberState — the plumber's position and motion, the battery and radar,
 * and the plumber's last-tile wetness (wet, read by the HUD hints).
 */
export function createPlumberState(level) {
  return {
    plumber: { x: level.spawn.x, y: level.spawn.y, face: -Math.PI / 2, stepT: 0, stepDur: 0.46, moving: false },
    batt: BATT_MAX,
    radar: false,
    radarRattleT: 0,
    battPulseT: 0,
    wet: 0,
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
    wetFloor: 0,
    floodCover: 0,
  };
}

/**
 * VisionState — vis/mask/cone arrays + visRegion/Step/FadeT + coneX/Y/Face/Radar + scopeDirty
 * plus the per-floor wantVision flag that gates the cone/mask work in update().
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
    visRegion: -1,
    visStep: 0,
    visFadeT: 0,
    coneX: NaN,
    coneY: NaN,
    coneFace: NaN,
    coneRadar: null,
    scopeDirty: false,
    wantVision: true,
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
 * DoorState — the exit's hold timer and whether the run has ended.
 * ended is set by run.js when a floor attempt finishes, and cleared at the
 * start of every update step.
 */
export function createDoorState() {
  return {
    descend: 0,
    ended: false,
  };
}
