/* Returns the cast for the level: one walker as far from the door as the
   geometry allows, the rest dormant coils spread across rooms. Pure. */
import { hash2 } from '../util/hash.js';

export function spawnAgents(level){
  const spawn = level.spawn;
  const spec = level.spec;
  const rng = level.rng;
  /* the room farthest from the door — where the walker starts, so nothing is
     standing in the room you walk into */
  let far = null, fd = -1;
  for (const r of level.rooms){
    const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
    const d = Math.hypot(cx-spawn.x, cy-spawn.y);
    if (d>fd){ fd=d; far=r; }
  }
  /* --- entities ---
     How many there are is a property of the LEVEL, not of the depth: level 1 is
     one thing in the building with you and level 5 is four, and the difference
     between them is entirely in what is walking around while you work.

     The first is a WALKER and spawns as far from the door as the geometry
     allows, so the level never opens with something standing in it. The rest are
     dormant coils, spread across rooms and never in the one you spawn in — a
     coil pile in the doorway is not difficulty, it is an ambush with no tell. */
  const agents = [];
  const agentRooms = new Set();
  const firstFar = far && far.rw>=5 && far.rh>=5
    ? far
    : level.rooms.reduce((b,r)=>{
        const d = Math.hypot(r.rx+r.rw/2-spawn.x, r.ry+r.rh/2-spawn.y);
        return (!b || d>b.d) ? {r,d} : b;
      }, null)?.r;
  if (spec.forms > 0 && firstFar){
    agentRooms.add(firstFar);
    agents.push({
      x: firstFar.rx+firstFar.rw/2, y: firstFar.ry+firstFar.rh/2,
      state:'WALK', t:0, rise:0, target:null,
      /* Hashed off the room it starts in, so the walker's opening facing is a
         property of the level like everything else here. Math.random() made one
         field of the cast unreproducible from the seed, and a run that cannot be
         rebuilt is not a run. */
      face: hash2(firstFar.rx, firstFar.ry)*6.28,
      wakeCd:0, stepT:0, born:3.5
    });
  }
  const coilRooms = level.rooms.filter(r=>r.rw>=5&&r.rh>=5 && !agentRooms.has(r));
  for (let i=0; coilRooms.length && agents.length<spec.forms; i++){
    const r = coilRooms[(rng()*coilRooms.length)|0];
    const cx = r.rx+r.rw/2, cy = r.ry+r.rh/2;
    /* Not in the spawn room, and not on top of a pipe: a coil sharing a tile
       with the only place you can stand to repair would make that pipe's five
       seconds unsurvivable by accident rather than by choice. */
    if (Math.hypot(cx-spawn.x, cy-spawn.y) < 9) continue;
    if (level.leaks.some(L=>Math.hypot(cx-(L.sx+0.5), cy-(L.sy+0.5)) < 4)) continue;
    agents.push({
      x: r.rx+1+Math.floor(rng()*(r.rw-2)),
      y: r.ry+1+Math.floor(rng()*(r.rh-2)),
      state:'DORMANT', t:0, rise:0, target:null, face:0,
      wakeCd:0, stepT:0, born:0
    });
  }
  return agents;
}
