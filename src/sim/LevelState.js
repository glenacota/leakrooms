/**
 * LevelState — static geometry + region data + floor/seed.
 * Never changes after the floor is built.
 */
import { MAP_H, MAP_W, WALL } from '../config/constants.js';
import { makeLos } from '../util/grid.js';

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