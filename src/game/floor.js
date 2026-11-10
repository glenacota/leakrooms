/* Builds one floor. The generated level and the G object that holds the floor's
   state are made here. The pixel layers the renderer draws (light, tiles, walls,
   mask and water) belong to render/floor-surfaces.js, and this file hands them
   the inputs they need.

   The build is split in two. getStaticLevel() makes the half a building
   decides: the layout, the light array, the region map. It holds that for one
   key (seed and floor number). makeFloorState() makes the half a player
   changes: the flood, the cast, the clock.

   The split is not tidiness. A retry rebuilds the same floor, so the static
   half is almost always already correct, and regenerating it means running a
   flood fill to arrive at the same answer. */

import { mulberry32 } from '../util/rng.js';
import { makeLos } from '../util/grid.js';
import { genLevel } from '../sim/level.js';
import { labelRegions } from '../sim/regions.js';
import { computeLightArr } from '../sim/lightmap.js';
import { scopeRoomLight, snapMask } from '../sim/vision.js';
import { initFlood } from '../sim/flood.js';
import { G, createGameState, setFloorState } from '../sim/state.js';
import { emit } from '../util/events.js';
import { resetRepaint } from '../util/repaint.js';
import { buildFloorSurfaces } from '../render/floor-surfaces.js';

/* ---------- The cached half ---------- */

let cacheKey = null;
let cache = null;

const keyOf = (seed, floorNum)=> `${seed}:${floorNum}`;

/**
 * The half of a floor that the seed decides and the player never changes: the
 * layout, the light array, the region map. One entry is held, for one key.
 *
 * Retrying a floor asks for the key it already has and gets the same object
 * back. Anything else releases the previous one on the way past.
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

  const level = genLevel(mulberry32(seed + floorNum*7919), floorNum);
  const { regionOf, regionAdj, regionCount } = labelRegions(level);
  const lightArr = computeLightArr(level, makeLos(level.grid));

  cache = { ...level, lightArr, regionOf, regionAdj, regionCount };
  return cache;
}

/* ---------- The floor's own state ---------- */

/**
 * Builds a floor on top of a static level: everything a plumber can change is
 * made new, and the arrays play mutates are cloned out of the cache so a
 * played floor cannot mark the building it came from.
 *
 * @param {object} level - the static level from getStaticLevel().
 * @param {number} floorNum - 0-based floor index.
 * @param {number} seed - the run seed.
 */
export function makeFloorState(level, floorNum, seed){
  setFloorState(createGameState(level, floorNum, seed));

  // Light the room the plumber starts in. From here on the lit room follows them.
  scopeRoomLight(G, G.plumber, G.radar, true);
  snapMask(G, G.plumber, G.radar);

  initFlood(G, G.plumber);
  resetRepaint();
}

/**
 * Builds a floor and stores it in G (see sim/state.js).
 *
 * The same seed and floor number always produce the same layout, so a retry
 * puts the leaks in the same rooms and hands back the same static canvases.
 *
 * @param {number} floorNum - 0-based floor index; picks the row in LEVELS.
 * @param {number} seed - the run seed.
 */
export function buildFloor(floorNum, seed){
  const level = getStaticLevel(seed, floorNum);
  buildFloorSurfaces(keyOf(seed, floorNum), level);
  makeFloorState(level, floorNum, seed);

  /* Render-only state keyed to a floor (the floor ripples) clears on this, so
     nothing from the last floor is drawn over the new one. */
  emit('floorBuilt');
}
