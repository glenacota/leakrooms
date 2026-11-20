import { mulberry32 } from '../util/rng.js';
import { makeLos } from '../util/grid.js';
import { genLevel } from '../sim/level.js';
import { genCompactFloor } from '../sim/compact-floor.js';
import { labelRegions } from '../sim/regions.js';
import { computeLightArr } from '../sim/lightmap.js';
import { scopeRoomLight, snapMask } from '../sim/vision.js';
import { initFlood } from '../sim/flood.js';
import { G, createGameState, setFloorState } from '../sim/state.js';
import { emit, EVENT } from '../util/events.js';
import { resetRepaint } from '../util/repaint.js';

/* Static level data is cached because retries repeat expensive generation.
   Mutable floor state is rebuilt even when the static key matches. */
let cacheKey = null;
let cache = null;

// floor mode from the URL query parameter: null (normal), 'easy' or 'hard'.
// easy and hard both use the compact single-room floor; only hard adds lifeforms.
let floorMode = null;

const keyOf = (seed, floorNum)=> `${seed}:${floorNum}${floorMode ? ':'+floorMode : ''}`;

export function applyFloorMode(mode){
  floorMode = mode;
}

export function getFloorMode(){
  return floorMode;
}

export function isEasyFloor(){
  return floorMode === 'easy';
}

/**
 * Builds or returns the static level data for a seed and floor.
 *
 * @param {number} seed - the run seed.
 * @param {number} floorNum - 0-based floor index.
 * @returns {object} the level with its light array and region map.
 */
export function getStaticLevel(seed, floorNum){
  const key = keyOf(seed, floorNum);
  if (cache && cacheKey === key) return cache;

  cacheKey = key;
  cache = null;

  const rng = mulberry32(seed + floorNum*7919);
  const level = floorMode ? genCompactFloor(rng, floorNum, floorMode) : genLevel(rng, floorNum);
  const { regionOf, regionAdj, regionCount } = labelRegions(level);
  const lightArr = computeLightArr(level, makeLos(level.grid));

  cache = { ...level, lightArr, regionOf, regionAdj, regionCount };
  return cache;
}

/**
 * Builds mutable floor state from a static level.
 *
 * @param {object} level - the static level from getStaticLevel().
 * @param {number} floorNum - 0-based floor index.
 * @param {number} seed - the run seed.
 */
export function buildFloorState(level, floorNum, seed){
  setFloorState(createGameState(level, floorNum, seed));

  scopeRoomLight(G, G.plumber, G.radar, true);
  snapMask(G, G.plumber, G.radar);

  initFlood(G);
  resetRepaint();
}

/**
 * Builds and stores a floor in G (the state).
 *
 * @param {number} floorNum - 0-based floor index; picks the row in LEVELS.
 * @param {number} seed - the run seed.
 */
export function buildFloor(floorNum, seed){
  const level = getStaticLevel(seed, floorNum);
  emit(EVENT.floorPreparing, keyOf(seed, floorNum), level);
  buildFloorState(level, floorNum, seed);
  emit(EVENT.floorBuilt);
}
