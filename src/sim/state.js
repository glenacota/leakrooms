import {
  createLevelState, createLeakState, createPlumberState, createLifeformState,
  createFloodState, createVisionState, createNoiseState, createClockState, createDoorState,
} from './state-domains.js';
import { repaintDirty } from '../util/repaint.js';

/* All the state of the current floor lives behind G. No state exists until
   the first buildFloor() call, and buildFloor() replaces it completely, so
   nothing that belongs to a floor can outlive that floor. Every module reads
   the floor through G.

   G is a facade, not the state itself. Every G.<field> read or write is
   forwarded to the domain object behind it, so a retry can install a whole new
   floor while every reader keeps the same G reference. The facade also keeps
   the floor's keys enumerable, so Object.keys(G) still lists exactly what a
   built floor owns. */

let domains = null;

/* Ownership map: which domain owns which key. */
const OWNER = {
  /* LevelState */
  floor: 'level', seed: 'level', grid: 'level', at: 'level', inB: 'level', los: 'level',
  rooms: 'level', exitTiles: 'level', fixtures: 'level', batteries: 'level', graffiti: 'level',
  lightArr: 'level', lightCv: 'level', lightCtx: 'level', lightImg: 'level',
  wallIdx: 'level', tilesCv: 'level', tilesCtx: 'level', wallsCv: 'level', wallsCtx: 'level',
  regionOf: 'level', regionAdj: 'level', regionCount: 'level',

  /* LeakState */
  leaks: 'leak', openLeaks: 'leak', totalLeaks: 'leak',

  /* PlumberState */
  plumber: 'plumber', batt: 'plumber', radar: 'plumber', radarRattleT: 'plumber', battPulseT: 'plumber',

  /* LifeformState */
  lifeforms: 'lifeform', seenBy: 'lifeform', nearest: 'lifeform', arng: 'lifeform',

  /* FloodState */
  wetArr: 'flood', waterDist: 'flood', wetByDist: 'flood', wetFront: 'flood',
  wetMaxDist: 'flood', wetSum: 'flood', wetEdgeD: 'flood', wetIndexAtDist: 'flood',
  wetCv: 'flood', wetCtx: 'flood', wetImg: 'flood', wetFloor: 'flood',
  floodCover: 'flood',

  /* VisionState */
  visArr: 'vision', visFrom: 'vision', visTgt: 'vision', visScratch: 'vision',
  maskArr: 'vision', maskTgt: 'vision', coneArr: 'vision',
  maskCv: 'vision', maskCtx: 'vision', maskImg: 'vision',
  visRegion: 'vision', visStep: 'vision', visFadeT: 'vision',
  coneX: 'vision', coneY: 'vision', coneFace: 'vision', coneRadar: 'vision',
  scopeDirty: 'vision',

  /* NoiseState */
  noise: 'noise', noisePeak: 'noise', selfNoise: 'noise', ambientNoise: 'noise', stat: 'noise',

  /* ClockState */
  time: 'clock', clock: 'clock', clockAnnounced: 'clock',

  /* DoorState */
  descend: 'door', ended: 'door', wet: 'door', atLeak: 'door',
  leakPower: 'door', leakTotal: 'door', leakDist: 'door',
};

/* The exact key order from the original flat object (pinned by tests/unit/state.test.js). */
const KEY_ORDER = [
  'floor', 'seed', 'grid', 'at', 'inB', 'los', 'rooms', 'exitTiles', 'leaks', 'fixtures',
  'batteries', 'graffiti', 'openLeaks', 'totalLeaks', 'lightArr', 'lightCv', 'lightCtx', 'lightImg',
  'visArr', 'visFrom', 'visTgt', 'visScratch', 'maskArr', 'maskTgt', 'coneArr', 'maskCv',
  'maskCtx', 'maskImg', 'wallIdx', 'tilesCv', 'tilesCtx', 'wallsCv', 'wallsCtx', 'regionOf',
  'regionAdj', 'regionCount', 'visRegion', 'visStep', 'visFadeT', 'coneX', 'coneY', 'coneFace',
  'coneRadar', 'scopeDirty', 'wetArr', 'waterDist', 'wetByDist', 'wetFront', 'wetMaxDist',
  'wetSum', 'wetEdgeD', 'wetIndexAtDist', 'wetCv', 'wetCtx', 'wetImg', 'ended', 'arng',
  'dirty', 'lifeforms', 'plumber', 'batt', 'radar', 'radarRattleT', 'battPulseT', 'noise', 'noisePeak',
  'selfNoise', 'ambientNoise', 'descend', 'clock', 'time', 'seenBy', 'nearest', 'stat',
  'wetFloor', 'wet', 'floodCover', 'atLeak', 'leakPower', 'leakTotal', 'leakDist', 'gfx',
];

/* Keys that exist on the facade but are computed/assembled (not owned by a single domain). */
const COMPUTED_KEYS = new Set(['gfx', 'dirty']);

function getTarget(k) {
  if (!domains) return null;
  const owner = OWNER[k];
  return owner ? domains[owner] : null;
}

function hasKey(k) {
  if (!domains) return false;
  return OWNER.hasOwnProperty(k) || COMPUTED_KEYS.has(k);
}

function assembleGfx(d) {
  return {
    lightCv: d.level.lightCv, lightCtx: d.level.lightCtx, lightImg: d.level.lightImg,
    maskCv: d.vision.maskCv, maskCtx: d.vision.maskCtx, maskImg: d.vision.maskImg,
    tilesCv: d.level.tilesCv, tilesCtx: d.level.tilesCtx,
    wallsCv: d.level.wallsCv, wallsCtx: d.level.wallsCtx,
    wetCv: d.flood.wetCv, wetCtx: d.flood.wetCtx, wetImg: d.flood.wetImg,
  };
}

export const G = new Proxy({}, {
  get(_, k) {
    if (!domains) return undefined;
    if (COMPUTED_KEYS.has(k)) {
      if (k === 'gfx') return assembleGfx(domains);
      if (k === 'dirty') return repaintDirty;
    }
    const target = getTarget(k);
    return target ? target[k] : undefined;
  },
  set(_, k, v) {
    if (!domains) return true;
    const target = getTarget(k);
    if (target) target[k] = v;
    return true;
  },
  has(_, k) {
    return hasKey(k);
  },
  ownKeys() {
    return domains ? KEY_ORDER : [];
  },
  getOwnPropertyDescriptor(_, k) {
    if (!hasKey(k)) return undefined;
    return { configurable: true, enumerable: true, writable: true, value: G[k] };
  },
});

/* The floor's own state. Pure: it allocates arrays and clones the level's
   mutable parts, and touches no canvas. The canvases and the G-dependent
   ticks are finished by game/floor.js, which owns the render side. */
export function createGameState(level, floorNum, seed){
  const levelState = createLevelState(level, floorNum, seed);
  const leakState = createLeakState(level);
  const plumberState = createPlumberState(level);
  const lifeformState = createLifeformState(level, seed, floorNum);
  const floodState = createFloodState();
  const visionState = createVisionState();
  const noiseState = createNoiseState();
  const clockState = createClockState();
  const doorState = createDoorState();

  return {
    level: levelState,
    leak: leakState,
    plumber: plumberState,
    lifeform: lifeformState,
    flood: floodState,
    vision: visionState,
    noise: noiseState,
    clock: clockState,
    door: doorState,
  };
}

/* Installs a floor's state (from createGameState) behind the facade. */
export function installFloorState(d){ domains = d; }