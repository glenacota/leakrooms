import { FLOOR, MAP_HEIGHT_TILES, MAP_WIDTH_TILES } from '../config/constants.js';

/**
 * Returns the brightest orthogonal floor neighbour of a wall tile.
 * @param {Uint8Array} grid - map tile types.
 * @param {Float32Array} arr - brightness per tile.
 * @param {number} i - index of the wall tile.
 * @returns {number} brightest neighbouring floor value, or zero when none exists.
 */
export function wallNeighbourMax(grid, arr, i) {
  const x = i % MAP_WIDTH_TILES, y = (i / MAP_WIDTH_TILES) | 0;
  let max = 0;
  if (x + 1 < MAP_WIDTH_TILES && grid[i + 1] === FLOOR) max = Math.max(max, arr[i + 1]);
  if (x > 0 && grid[i - 1] === FLOOR) max = Math.max(max, arr[i - 1]);
  if (y + 1 < MAP_HEIGHT_TILES && grid[i + MAP_WIDTH_TILES] === FLOOR) max = Math.max(max, arr[i + MAP_WIDTH_TILES]);
  if (y > 0 && grid[i - MAP_WIDTH_TILES] === FLOOR) max = Math.max(max, arr[i - MAP_WIDTH_TILES]);
  return max;
}
