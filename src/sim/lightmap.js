import { BAKE_FLOOR, FLOOR, MAP_H, MAP_W, WALL } from '../config/constants.js';
import { makeLos } from '../util/grid.js';

/**
 * Works out how bright each tile is under its own ceiling lights (the "bake").
 * This does not decide what the player can see; that is the visibility mask
 * (see vision.js). It returns a Float32Array of brightness per tile.
 *
 * @param {object} level - the result of genLevel (grid and fixtures are used).
 * @param {Function} [los] - a line-of-sight function; built from the grid if omitted.
 * @returns {Float32Array} brightness per tile.
 */
export function computeLightArr(level, los) {
  const grid = level.grid;
  const at = (x, y) => grid[y * MAP_W + x];
  const inB = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  if (!los) los = makeLos(grid);

  const lightArr = new Float32Array(MAP_W * MAP_H);

  // Step 1: each fixture lights the tiles it can see, fading with distance. A tile keeps the brightest light that reaches it.
  for (const f of level.fixtures) {
    const R2 = f.r * f.r;
    const x0 = Math.max(0, Math.floor(f.x - f.r)), x1 = Math.min(MAP_W - 1, Math.ceil(f.x + f.r));
    const y0 = Math.max(0, Math.floor(f.y - f.r)), y1 = Math.min(MAP_H - 1, Math.ceil(f.y + f.r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d2 = (x + 0.5 - f.x) ** 2 + (y + 0.5 - f.y) ** 2;
      if (d2 > R2) continue;
      if (at(x, y) === WALL) continue;
      if (!los(f.x, f.y, x + 0.5, y + 0.5)) continue;
      const fall = 1 - Math.sqrt(d2) / f.r;
      const v = Math.min(1, f.i * fall * fall * 1.95);
      const i0 = y * MAP_W + x;
      if (v > lightArr[i0]) lightArr[i0] = v;
    }
  }
  /* Step 2: a 3x3 blur for a soft falloff. A wider blur would dilute a single
     lit tile into nothing and leave the floor black between fixtures. */
  const tmp = new Float32Array(lightArr);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      s += tmp[ny * MAP_W + nx]; n++;
    }
    lightArr[y * MAP_W + x] = s / n;
  }
  /* Step 3: a minimum brightness for floor tiles. It is high (BAKE_FLOOR), because
     darkness is the mask's job: a room you cannot see is multiplied by zero
     whatever its lights are doing. The bake only describes lit surfaces, so a
     visible room shows the palette at full strength with the fixtures as bright
     pools on top. */
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = y * MAP_W + x;
    if (at(x, y) === FLOOR && lightArr[i] < BAKE_FLOOR) lightArr[i] = BAKE_FLOOR;
  }
  /* Step 4: walls catch light from the floor beside them, because their faces
     are visible. This must read the values AFTER the blur and the minimum.
     Reading the earlier values gave walls next to unlit floor almost no light,
     and every partition looked like a hole in the ground. */
  const wallSrc = new Float32Array(lightArr);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = y * MAP_W + x;
    if (at(x, y) !== WALL) continue;
    let m = 0;
    if (inB(x + 1, y) && at(x + 1, y) === FLOOR) m = Math.max(m, wallSrc[i + 1]);
    if (inB(x - 1, y) && at(x - 1, y) === FLOOR) m = Math.max(m, wallSrc[i - 1]);
    if (inB(x, y + 1) && at(x, y + 1) === FLOOR) m = Math.max(m, wallSrc[i + MAP_W]);
    if (inB(x, y - 1) && at(x, y - 1) === FLOOR) m = Math.max(m, wallSrc[i - MAP_W]);
    // A wall deep inside a block still gets a little bounce light from its room.
    lightArr[i] = Math.max(m * 0.95, BAKE_FLOOR * 0.80);
  }
  return lightArr;
}