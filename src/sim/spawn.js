/* Creates the lifeforms for a level. Pure: it returns the list and touches no
   other state. How many there are comes from the level (LEVELS), not from the
   floor depth. */

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
     allows. The rest are DORMANT coils spread across other rooms, never the
     spawn room (a coil in the doorway would be an ambush with no warning, not
     difficulty). */
  const lifeforms = [];
  const lifeformRooms = new Set();
  if (spec.lifeforms > 0 && far){
    lifeformRooms.add(far);
    lifeforms.push({
      x: far.rx+far.rw/2, y: far.ry+far.rh/2,
      state:'WALK', t:0, rise:0, target:null,
      // The opening direction is hashed from the room, so it depends only on the level. Math.random() would make it impossible to reproduce from the seed.
      face: hash2(far.rx, far.ry)*6.28,
      born:3.5
    });
  }
  const coilRooms = level.rooms.filter(r=>r.rw>=5&&r.rh>=5 && !lifeformRooms.has(r));
  // Bound the placement attempts so a run of bad RNG draws cannot loop forever.
  for (let attempts=0; coilRooms.length && lifeforms.length<spec.lifeforms && attempts<coilRooms.length*4; attempts++){
    const r = coilRooms[(rng()*coilRooms.length)|0];
    const cx = r.rx+r.rw/2, cy = r.ry+r.rh/2;
    /* Not in the spawn room, and not on top of a pipe: a coil sharing a tile with
       the only place to stand and repair would make that pipe unsurvivable by
       accident and not by choice. */
    if (Math.hypot(cx-spawn.x, cy-spawn.y) < 9) continue;
    if (level.leaks.some(L=>Math.hypot(cx-(L.sx+0.5), cy-(L.sy+0.5)) < 4)) continue;
    lifeforms.push({
      x: r.rx+1+Math.floor(rng()*(r.rw-2)),
      y: r.ry+1+Math.floor(rng()*(r.rh-2)),
      state:'DORMANT', t:0, rise:0, target:null, face:0,
      born:0
    });
  }
  return lifeforms;
}