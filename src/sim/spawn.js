/* Creates the lifeforms for a level. Pure: it returns the list and touches no
   other state. How many there are comes from the level (LEVELS), not from the
   floor depth. */

import { MAP, TILE_TYPES } from '../config/constants.js';
import { hash2 } from '../util/hash.js';

/**
 * @param {object} level - the result of genLevel.
 * @param {Function} rng - seeded random function (0 to 1).
 * @returns {object[]} the lifeforms: one walker first, then dormant coils.
 */
export function spawnLifeforms(level, rng){
  const spawn = level.spawn;
  const spec = level.spec;
  // The room farthest from the door, where the walker starts, so nothing is standing in the room you walk into.
  let far = null, fd = -1;
  for (const r of level.rooms){
    const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
    const d = Math.hypot(cx-spawn.x, cy-spawn.y);
    if (d>fd){ fd=d; far=r; }
  }
  /* The first lifeform is a WALKER, placed as far from the door as the map
     allows. The rest are DORMANT spread across other rooms, never the
     spawn room. */
  const lifeforms = [];
  const lifeformRooms = new Set();
  if (spec.lifeforms > 0 && far){
    lifeformRooms.add(far);
    let x = far.rx+far.rw/2;
    let y = far.ry+far.rh/2;
    if (level.rooms.length === 1){
      const candidates = [];
      for (let cy = far.ry + 1; cy < far.ry + far.rh - 1; cy++){
        for (let cx = far.rx + 1; cx < far.rx + far.rw - 1; cx++){
          if (level.grid[cy * MAP.WIDTH_TILES + cx] !== TILE_TYPES.FLOOR) continue;
          const tileX = cx + 0.5, tileY = cy + 0.5;
          const distance = Math.hypot(tileX - spawn.x, tileY - spawn.y);
          if (distance < 4) continue;
          if (level.leaks.some(L => Math.hypot(tileX - (L.sx + 0.5), tileY - (L.sy + 0.5)) < 4)) continue;
          candidates.push({ x: tileX, y: tileY, distance });
        }
      }
      candidates.sort((a, b) => b.distance - a.distance);
      if (candidates.length){
        x = candidates[0].x;
        y = candidates[0].y;
      }
    }
    lifeforms.push({
      x, y,
      state:'WALK', t:0, rise:0, target:null,
      // The opening direction is hashed from the room, so it depends only on the level. Math.random() would make it impossible to reproduce from the seed.
      face: hash2(far.rx, far.ry)*6.28,
      born:3.5,
      hold: 0, holdDone: false
    });
  }
  const coilRooms = level.rooms.filter(r=>r.rw>=5&&r.rh>=5 && !lifeformRooms.has(r));
  // Bound the placement attempts so a run of bad RNG draws cannot loop forever.
  for (let attempts=0; coilRooms.length && lifeforms.length<spec.lifeforms && attempts<coilRooms.length*4; attempts++){
    const r = coilRooms[(rng()*coilRooms.length)|0];
    const cx = r.rx+r.rw/2, cy = r.ry+r.rh/2;
    /* Not in the spawn room, and not on top of a leak. */
    if (Math.hypot(cx-spawn.x, cy-spawn.y) < 9) continue;
    if (level.leaks.some(L=>Math.hypot(cx-(L.sx+0.5), cy-(L.sy+0.5)) < 4)) continue;
    lifeforms.push({
      x: r.rx+1+Math.floor(rng()*(r.rw-2)),
      y: r.ry+1+Math.floor(rng()*(r.rh-2)),
      state:'DORMANT', t:0, rise:0, target:null, face:0,
      born:0,
      hold: 0, holdDone: false
    });
  }
  /* A single-room hard floor has no other rooms: place the remaining lifeforms
     as far from the plumber's spawn as the room allows, spreading them across
     the far side instead of clustering in one corner. */
  if (far && level.rooms.length === 1 && lifeforms.length<spec.lifeforms){
    const want = spec.lifeforms - lifeforms.length;
    /* Candidate floor tiles across the room interior, clear of the plumber
       spawn and the leaks, scored by distance from spawn. */
    const cands = [];
    for (let y = far.ry + 1; y < far.ry + far.rh - 1; y++){
      for (let x = far.rx + 1; x < far.rx + far.rw - 1; x++){
        if (level.grid[y * MAP.WIDTH_TILES + x] !== TILE_TYPES.FLOOR) continue;
        const cx = x + 0.5, cy = y + 0.5;
        const d = Math.hypot(cx - spawn.x, cy - spawn.y);
        if (d < 4) continue;
        if (level.leaks.some(L => Math.hypot(cx - (L.sx + 0.5), cy - (L.sy + 0.5)) < 4)) continue;
        cands.push({ x: cx, y: cy, d });
      }
    }
    cands.sort((a, b) => b.d - a.d);
    /* Farthest-point sampling: take the farthest candidate that stays well
       clear of already-placed lifeforms, so they spread across the far side. */
    const placed = [];
    for (const c of cands){
      if (placed.length >= want) break;
      if (placed.some(p => Math.hypot(c.x - p.x, c.y - p.y) < 3)) continue;
      placed.push(c);
    }
    for (const c of placed){
      lifeforms.push({
        x: c.x, y: c.y,
        state:'DORMANT', t:0, rise:0, target:null, face:0,
        born:0,
        hold: 0, holdDone: false
      });
    }
  }
  return lifeforms;
}
