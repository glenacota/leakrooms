import { MAP, TILE_TYPES } from '../config/constants.js';

/**
 * Returns the brightest orthogonal floor neighbour of a wall tile.
 * @param {Uint8Array} grid - map tile types.
 * @param {Float32Array} arr - brightness per tile.
 * @param {number} i - index of the wall tile.
 * @returns {number} brightest neighbouring floor value, or zero when none exists.
 */
export function wallNeighbourMax(grid, arr, i) {
  const x = i % MAP.WIDTH_TILES, y = (i / MAP.WIDTH_TILES) | 0;
  let max = 0;
  if (x + 1 < MAP.WIDTH_TILES && grid[i + 1] === TILE_TYPES.FLOOR) max = Math.max(max, arr[i + 1]);
  if (x > 0 && grid[i - 1] === TILE_TYPES.FLOOR) max = Math.max(max, arr[i - 1]);
  if (y + 1 < MAP.HEIGHT_TILES && grid[i + MAP.WIDTH_TILES] === TILE_TYPES.FLOOR) max = Math.max(max, arr[i + MAP.WIDTH_TILES]);
  if (y > 0 && grid[i - MAP.WIDTH_TILES] === TILE_TYPES.FLOOR) max = Math.max(max, arr[i - MAP.WIDTH_TILES]);
  return max;
}
