import { genMaze } from './maze.js';
import { MAP_W, MAP_H, WALL, FLOOR, PIPE_GAP, REPAIR_REACH, PIPE_FAR, R } from '../config/constants.js';
import { LEVELS, LEVELS_N } from '../config/levels.js';
import { NOTES } from '../config/notes.js';
import { hash2 } from '../util/hash.js';

/**
 * Generates a whole level from a seeded random function: the maze, the door,
 * the pipes, the ceiling lights, the batteries and the notes on the carpet. It
 * is a pure function of its inputs, so the same seed always gives the same
 * level. It needs no floor state (G), so the tests call it on its own.
 *
 * @param {Function} rng - seeded random function (0 to 1).
 * @param {number} [floorNum] - 0-based floor index; picks the row in LEVELS.
 * @returns {object} grid, rooms, spawn, exit (the door), leaks, fixtures,
 *   batteries, graffiti, spec (the LEVELS row) and rng.
 */
export function genLevel(rng, floorNum=0){
  const maze = genMaze(rng);
  const grid = maze.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  const INTERIOR = (x,y)=> x>0 && y>0 && x<MAP_W-1 && y<MAP_H-1;
  const touchesFloor = (tx,ty)=>
    (inB(tx+1,ty)&&at(tx+1,ty)===FLOOR)||(inB(tx-1,ty)&&at(tx-1,ty)===FLOOR)||
    (inB(tx,ty+1)&&at(tx,ty+1)===FLOOR)||(inB(tx,ty-1)&&at(tx,ty-1)===FLOOR);

  /* ---------- The door ----------
     One door, found from the spawn room. It is known from the first frame
     because the player walked in through it, so there is nothing to search
     for. The level is a journey (do the work, then walk back before the clock
     runs out), not a hunt for the exit. */

  // Which way the door opens
  const FACINGS = [['S',0,1],['N',0,-1],['E',1,0],['W',-1,0]];
  function wallFacing(tx, ty, r){
    const open = [];
    for (const [dir,dx,dy] of FACINGS)
      if (inB(tx+dx,ty+dy) && at(tx+dx,ty+dy)===FLOOR) open.push({dir,dx,dy});
    if (!open.length) return 'S';            // cannot happen: the slot touches floor
    /* South wins whenever it is available. The renderer paints the wall face on
       the south side, so a door facing any other way would not match the wall
       behind it. (A pillar corner with floor to the south and east is the
       usual case.) The room-centre sort only decides cases the slot rule
       cannot reach. */
    if (open.some(o=>o.dir==='S')) return 'S';
    if (open.length>1 && r){
      const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
      open.sort((a,b)=>Math.hypot(tx+a.dx-cx, ty+a.dy-cy)-Math.hypot(tx+b.dx-cx, ty+b.dy-cy));
    }
    return open[0].dir;
  }

  /* A slot for the door is a wall tile with floor directly SOUTH of it. This is
     a rendering rule and not a style choice: the bake paints one wall face per
     wall tile, the south one, into the floor tile below it. A door anywhere
     else would stand on a dark ceiling top with no lit wall behind it, and
     look like a frame painted on the floor. Touching floor on any side is not
     enough: a wall on the east side of a room touches floor but has no face. */
  const southFacing = (tx,ty)=> INTERIOR(tx,ty) && at(tx,ty)===WALL
                                     && INTERIOR(tx,ty+1) && at(tx,ty+1)===FLOOR;

  /* Finds door slots for a room, trying wider searches until something fits:
       1. the ring of tiles just around the room
       2. any usable wall tile near this room (in a dense map the ring is often
          another room's floor)
       3. any usable wall tile on the map, nearest the room first, so the level
          stays winnable even if the room is walled in by other rooms */
  function wallSlotFor(r){
    const ring = [];
    for (let x=r.rx; x<r.rx+r.rw; x++){ ring.push([x,r.ry-1]); ring.push([x,r.ry+r.rh]); }
    for (let y=r.ry; y<r.ry+r.rh; y++){ ring.push([r.rx-1,y]); ring.push([r.rx+r.rw,y]); }
    let cand = ring.filter(([tx,ty]) => southFacing(tx,ty));

    if (!cand.length){
      const near = [];
      for (let y=r.ry-1; y<=r.ry+r.rh; y++) for (let x=r.rx-1; x<=r.rx+r.rw; x++){
        if (southFacing(x,y)) near.push([x,y]);
      }
      cand = near;
    }
    if (!cand.length){
      const any = [];
      for (let y=1;y<MAP_H-1 && any.length<4000;y++) for (let x=1;x<MAP_W-1;x++){
        if (southFacing(x,y)) any.push([x,y]);
      }
      // Sorted before the slice, so the cap keeps the nearest USABLE tiles
      const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
      any.sort((a,b)=>Math.hypot(a[0]-cx,a[1]-cy)-Math.hypot(b[0]-cx,b[1]-cy));
      cand = any.slice(0,60);
    }
    return cand;
  }

  const candidates = maze.rooms.filter(r=>r.rw>=6 && r.rh>=6);
  const pool = candidates.length>=6 ? candidates : maze.rooms;
  const entryRoom = pool[0];
  // The spawn point. The pipes are placed relative to it, so it is worked out first.
  const spawn = { x: entryRoom.rx + entryRoom.rw/2, y: entryRoom.ry + entryRoom.rh/2 };

  const exitTiles = [];
  {
    let cand = wallSlotFor(entryRoom);
    if (!cand.length) cand = wallSlotFor(maze.rooms[(rng()*maze.rooms.length)|0] || entryRoom);
    if (cand.length){
      const [bx,by] = cand[(rng()*cand.length)|0];
      exitTiles.push({x:bx, y:by, open:0, facing:wallFacing(bx,by,entryRoom)});
    }
  }
  /* A last resort that should never run on a 76x76 map, because every room has
     wall around it. It exists so the player never gets a level without a door.
     It scans the whole map for a tile that follows the same south-facing rule,
     and only if that fails too does it use a fixed tile. */
  if (!exitTiles.length){
    let fb = null;
    outer: for (let y=1; y<MAP_H-1 && !fb; y++)
      for (let x=1; x<MAP_W-1; x++)
        if (southFacing(x,y)){ fb = [x,y]; break outer; }
    if (!fb) fb = [1,1];
    exitTiles.push({x:fb[0], y:fb[1], open:0, facing:'S'});
  }

  /* ---------- The pipes ----------
     Each pipe is a single wall tile, as far from the spawn as the map allows. It
     must be a WALL that touches walkable floor: you cannot wrench a pipe that
     opens onto solid rock. If the farthest tile is unusable the search steps
     back toward the spawn, because an unreachable pipe makes the level
     unwinnable and every repair is required.

     Farthest-first means the usual case is a real trek and the rare case is a
     shorter one. With several pipes, picks must be PIPE_GAP apart, so four pipes
     are four corners of the building and not four faces of one wall. */
  const faceTiles = [];
  for (let y=1;y<MAP_H-1;y++) for (let x=1;x<MAP_W-1;x++){
    if (at(x,y)!==WALL) continue;
    if (!touchesFloor(x,y)) continue;
    faceTiles.push({x, y, d: Math.hypot(x+0.5-spawn.x, y+0.5-spawn.y)});
  }
  faceTiles.sort((a,b)=> b.d - a.d);

  const standSpot = (c) => {
    /* Finds the standing spot: the floor tile beside the pipe where the player
       can physically stand. The player stands on the CENTRE of that tile. (An
       earlier version nudged the spot flush against the wall, which is where the
       collision circle already stops the player, so every candidate counted as
       "inside" and every level used the fallback.) How close counts as "at the
       pipe" is REPAIR_REACH's job, not this function's.

       It checks the local grid and not blocked(), because G does not exist yet
       while the level is being built. */
    for (const [nx,ny] of [[c.x+1,c.y],[c.x-1,c.y],[c.x,c.y+1],[c.x,c.y-1]]){
      if (!inB(nx,ny) || at(nx,ny)!==FLOOR) continue;
      const px = nx + 0.5, py = ny + 0.5;
      let inside = false;
      for (let ty=Math.floor(py-R); ty<=Math.floor(py+R) && !inside; ty++)
        for (let tx=Math.floor(px-R); tx<=Math.floor(px+R); tx++){
          if (!inB(tx,ty) || at(tx,ty)!==WALL) continue;
          const cx = px<tx?tx:(px>tx+1?tx+1:px);
          const cy = py<ty?ty:(py>ty+1?ty+1:py);
          if ((px-cx)**2 + (py-cy)**2 < R*R){ inside=true; break; }
        }
      if (inside) continue;
      return {x:nx, y:ny};
    }
    return null;
  };
  // The room a standing spot is in, for the battery guarantee below. A pipe is a wall tile and belongs to no room, but the floor beside it does.
  const roomAt = (tx,ty) =>
    maze.rooms.find(r=>tx>=r.rx&&tx<r.rx+r.rw&&ty>=r.ry&&ty<r.ry+r.rh) || null;

  // How many pipes this level has is fixed by the level, not by difficulty (see LEVELS).
  const spec = LEVELS[Math.min(floorNum, LEVELS_N-1)];
  const want = spec.leaks;
  const leaks = [];
  const reach = PIPE_FAR[Math.min(want, PIPE_FAR.length)-1];
  const capped = faceTiles.filter(c=>c.d <= reach);
  const shortlist = (capped.length ? capped : faceTiles);
  /* Scan the shortlist (farthest first). The first pick that keeps the required
     gap wins. If that does not find enough pipes, the gap is relaxed twice.

     The gap is measured between STANDING SPOTS, not wall tiles. Two pipes three
     wall tiles apart can have standing spots 1.0 apart, which is inside
     REPAIR_REACH, and then one five-second hold would seal both pipes. Each pipe
     must need its own repair. */
  for (let gap of [PIPE_GAP, Math.max(4, PIPE_GAP>>1), 0]){
    for (const c of shortlist){
      if (leaks.length >= want) break;
      const spot = standSpot(c);
      if (!spot) continue;
      if (leaks.some(L=>Math.hypot(L.sx-spot.x, L.sy-spot.y) < gap+REPAIR_REACH)) continue;
      const L = { x:c.x, y:c.y, sx:spot.x, sy:spot.y,
                  fixed:false, repair:0, fixedAt:0 };
      L.room = roomAt(spot.x, spot.y);
      leaks.push(L);
    }
    if (leaks.length >= want) break;
  }
  /* Should never run on a map this size, since there are always interior walls.
     It exists so a mandatory objective never fails softly. */
  while (leaks.length < want){
    const L = { x:1, y:1, sx:1, sy:1, fixed:false, repair:0, fixedAt:0 };
    L.room = entryRoom;
    leaks.push(L);
  }

  /* Picks a floor tile inside a room. Rooms contain wall stubs, so a random pick
     can land inside a wall and is checked. `away` and `minD` keep a pickup away
     from a point (the spawn, or a pipe), so a battery is never handed over for free. */
  const floorTileIn = (r, pad=1, away=null, minD=0) => {
    const w = r.rw-2*pad, h = r.rh-2*pad;
    if (w > 0 && h > 0){
      for (let i=0;i<16;i++){
        const tx = r.rx+pad + Math.floor(rng()*w);
        const ty = r.ry+pad + Math.floor(rng()*h);
        if (maze.grid[ty*MAP_W+tx]!==FLOOR) continue;
        if (away && Math.hypot(tx+0.5-away.x, ty+0.5-away.y) < minD) continue;
        return {x:tx, y:ty};
      }
    }
    /* The fallback is the room's centre. For the spawn room that is the spawn
       itself, so the pickup would be collected on the first frame. Placing no
       battery is better than placing one on the player's head. */
    const fb = { x: r.rx + (r.rw>>1), y: r.ry + (r.rh>>1) };
    if (away && Math.hypot(fb.x+0.5-away.x, fb.y+0.5-away.y) < minD) return null;
    return fb;
  };

  /* ---------- Ceiling lights ----------
     About 18% of rooms have no light, and large rooms sometimes get two. */
  const fixtures = [];
  for (const r of maze.rooms){
    if (r.rw<4 || r.rh<4) continue;
    if (rng() < 0.18) continue;
    const n = (r.rw*r.rh > 260 && rng()<0.4) ? 2 : 1;
    for (let i=0;i<n;i++){
      // The light's radius follows the room size, so no room is left as a black hole
      const rad = Math.max(9, Math.min(19, Math.hypot(r.rw, r.rh)*0.62));
      const sp = floorTileIn(r);
      fixtures.push({
        x: sp.x + 0.5,
        y: sp.y + 0.5,
        r: rad * (0.85 + rng()*0.3),
        i: 0.85 + rng()*0.2,
        /* The flicker rate comes from a hash of the light's own tile and not from
           the global random generator. It is a property of that light, the same
           every time the level is built. Using Math.random() here made it the one
           part of the level that a seed could not reproduce. The hash draws
           nothing from rng, so the layout is unchanged. */
        flicker: rng() < 0.16 ? (0.5 + hash2(Math.floor(sp.x*7), Math.floor(sp.y*13))*2.4) : 0,
        phase: rng()*Math.PI*2
      });
    }
  }

  /* ---------- Batteries ----------
     Guaranteed: one in the door's room, and one in the room each pipe's standing
     spot is in. The water leads you to the pipe, so the battery that powers the
     radar is next to the work. With several pipes and three minutes you will
     sweep more than once, and a budget that can run dry between pipes is one
     you cannot plan around. */
  const batteries = [];
  const litRooms = maze.rooms.filter(r=>fixtures.some(f=>f.x>=r.rx&&f.x<=r.rx+r.rw&&f.y>=r.ry&&f.y<=r.ry+r.rh));
  const battRooms = new Set();
  for (const b of [{room:entryRoom, away:spawn, d:3}, ...leaks.map(L=>({room:L.room, away:{x:L.sx+0.5,y:L.sy+0.5}, d:1.5}))]){
    const r = b.room;
    if (!r || r.rw<5 || r.rh<5) continue;
    // One per room: two pipes can share a room, and two stacked batteries look like a bug.
    if (battRooms.has(r)) continue;
    battRooms.add(r);
    // Never within reach of the spawn or of the pipe's own standing spot: that would be battery you did not have to walk for.
    const sp = floorTileIn(r, 1, b.away, b.d);
    if (!sp) continue;
    batteries.push({ x: sp.x+0.5, y: sp.y+0.5, taken:false });
  }
  // Extra batteries scattered around, more on later floors. Most go in lit rooms.
  for (let i=0;i<6+floorNum*2;i++){
    const src = (rng()<0.6 && litRooms.length) ? litRooms : maze.rooms;
    const r = src[(rng()*src.length)|0];
    if (!r || r.rw<4||r.rh<4) continue;
    // They respect the spawn exclusion too, so none is handed over for walking through the door.
    const sp = floorTileIn(r, 1, spawn, 3);
    if (!sp) continue;
    batteries.push({ x: sp.x+0.5, y: sp.y+0.5, taken:false });
  }

  /* ---------- Notes on the carpet ----------
     Short scrawled messages (see config/notes.js), read when the radar puts
     them on screen. */
  const graffiti = [];
  for (let i=0;i<9+floorNum*2;i++){
    const r = maze.rooms[(rng()*maze.rooms.length)|0];
    if (!r || r.rw<5||r.rh<5) continue;
    const sp = floorTileIn(r);
    graffiti.push({ x: sp.x+0.5, y: sp.y+0.5,
                    text:NOTES[(rng()*NOTES.length)|0], seen:false });
  }

  return { grid, rooms: maze.rooms, leaves: maze.leaves, spawn, exit: exitTiles,
           leaks, fixtures, batteries, graffiti, spec, rng };
}