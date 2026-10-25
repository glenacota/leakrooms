import { FLOOR, HOP_FALL, MAP_H, MAP_W } from '../config/constants.js';

/**
 * Splits the floor into "regions" and works out which regions touch.
 * A region is one lit space: a room, or a stretch of floor between rooms (a
 * gate tunnel). This is what makes "the room you are in" a well-defined thing.
 * The whole maze is one connected area, so a simple flood fill from the player
 * would light everything and the room-scoped light would do nothing.
 *
 * @param {object} level - the result of genLevel.
 * @returns {{regionOf: Int32Array, regionAdj: number[][], regionCount: number}}
 */
export function labelRegions(level) {
  const grid = level.grid;
  const at = (x, y) => grid[y * MAP_W + x];

  /* ---------- Rooms ----------
     Room rectangles come from separate BSP leaves, so they never overlap. Only
     FLOOR tiles inside a rectangle are labelled. Labelling the whole rectangle
     would include the small wall stubs that rooms are carved with, and a stub
     would then take its room's brightness directly and skip the
     brightest-neighbour rule used for walls (see scopeRoomLight), so a wall in the
     middle of a room rendered darker than the floor around it. Walls are lit BY
     the spaces around them. This also keeps a stub from splitting a room into
     two regions, which is right: a stub is furniture, not a doorway. */
  const regionOf = new Int32Array(MAP_W * MAP_H).fill(-1);
  level.rooms.forEach((r, ri) => {
    for (let y = r.ry; y < r.ry + r.rh; y++)
      for (let x = r.rx; x < r.rx + r.rw; x++)
        if (at(x, y) === FLOOR) regionOf[y * MAP_W + x] = ri;
  });
  /* ---------- Corridors ----------
     The tiles between rooms are not in any rectangle. Each connected group of
     them is flood filled into its own region, because standing in a doorway
     lights the doorway, not the whole room behind you. */
  let nRegions = level.rooms.length;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i0 = y * MAP_W + x;
    if (at(x, y) !== FLOOR || regionOf[i0] >= 0) continue;
    const id = nRegions++;
    const stack = [i0]; regionOf[i0] = id;
    while (stack.length) {
      const c = stack.pop(), cx = c % MAP_W, cy = (c / MAP_W) | 0;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = ny * MAP_W + nx;
        if (at(nx, ny) !== FLOOR || regionOf[ni] >= 0) continue;
        regionOf[ni] = id; stack.push(ni);
      }
    }
  }
  /* ---------- Adjacency ----------
     Two regions are neighbours when they share an edge of floor tiles. A room
     with two gates has two different neighbours, so the search needs the real
     graph and not just "the next room over". */
  const regAdj = Array.from({ length: nRegions }, () => []);
  const regSeen = new Set();
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const a = regionOf[y * MAP_W + x];
    if (a < 0) continue;
    for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
      if (nx >= MAP_W || ny >= MAP_H) continue;
      const b = regionOf[ny * MAP_W + nx];
      if (b < 0 || a === b) continue;
      const key = a < b ? a + ',' + b : b + ',' + a;
      if (regSeen.has(key)) continue;
      regSeen.add(key);
      regAdj[a].push(b); regAdj[b].push(a);
    }
  }

  return { regionOf, regionAdj: regAdj, regionCount: nRegions };
}

// How much of a room's own light you can see through `hops` gates (see HOP_FALL).
export function scopeFor(hops) {
  if (hops < 0) return 0;
  return HOP_FALL[Math.min(hops, HOP_FALL.length - 1)];
}

/**
 * Creates a regionAt function bound to a specific regionOf array.
 * @param {Int32Array} regionOf
 * @returns {(x:number, y:number)=>number}
 */
export function createRegionAt(regionOf) {
  return (x, y) => {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return -1;
    return regionOf[ty * MAP_W + tx];
  };
}