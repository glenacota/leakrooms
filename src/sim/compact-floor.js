import { MAP, TILE_TYPES } from '../config/constants.js';
import { LEVELS, LEVELS_N } from '../config/levels.js';
import { NOTES } from '../config/notes.js';

// How many lifeforms a hard compact floor fills its single room with.
const LIFEFORMS_HARD_MODE = 2;

/**
 * Builds a compact test floor inside the normal-sized grid.
 * @param {Function} rng - seeded random function.
 * @param {number} floorNum - 0-based floor index.
 * @param {'easy'|'hard'|null} mode - 'easy' seals with no lifeforms, 'hard' fills the room with lifeforms.
 * @returns {object} a level compatible with the normal floor builder.
 */
export function genCompactFloor(rng, floorNum, mode){
  // Four leaks fit on the north wall with distinct repair ranges and room for the door.
  const room = { rx: Math.floor((MAP.WIDTH_TILES-18)/2), ry: Math.floor((MAP.HEIGHT_TILES-12)/2), rw: 18, rh: 12 };
  const grid = new Uint8Array(MAP.WIDTH_TILES*MAP.HEIGHT_TILES);
  for (let y=room.ry; y<room.ry+room.rh; y++)
    for (let x=room.rx; x<room.rx+room.rw; x++) grid[y*MAP.WIDTH_TILES+x] = TILE_TYPES.FLOOR;

  const spec = { ...LEVELS[Math.min(floorNum, LEVELS_N-1)], lifeforms: mode === 'hard' ? LIFEFORMS_HARD_MODE : 0 };
  const doorRight = rng() < 0.5;
  const shift = Math.floor(rng()*2);
  const leaks = Array.from({ length: spec.leaks }, (_, i) => {
    const x = room.rx + 3 + shift + i*4;
    return { x, y:room.ry-1, sx:x, sy:room.ry, fixed:false, repair:0, fixedAt:0, room };
  });
  const spawn = { x:room.rx+room.rw/2, y:room.ry+room.rh/2 };
  const exit = [{ x:room.rx+(doorRight ? room.rw-1 : 0), y:room.ry-1, open:0, facing:'S' }];
  const fixtures = [{ x:spawn.x, y:spawn.y, r:19, i:1, flicker:0, phase:0 }];
  const batteries = [{ x:room.rx+2.5, y:room.ry+room.rh-2.5, taken:false }];
  const notes = [{ x:room.rx+room.rw-2.5, y:room.ry+room.rh-2.5,
    text:NOTES[Math.floor(rng()*NOTES.length)], seen:false }];
  return { grid, rooms:[room], spawn, exit, leaks, fixtures, batteries, notes, spec };
}
