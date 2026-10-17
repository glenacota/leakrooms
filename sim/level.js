import { genMaze } from './maze.js';
import { MAP_W, MAP_H, WALL, FLOOR, PIPE_GAP, REPAIR_REACH, PIPE_FAR, R } from '../config/constants.js';
import { LEVELS, LEVELS_N } from '../config/levels.js';
import { NOTES } from '../config/notes.js';
export function genLevel(rng, floorNum=0){
  const maze = genMaze(rng);
  const grid = maze.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  const INTERIOR = (x,y)=> x>0 && y>0 && x<MAP_W-1 && y<MAP_H-1;
  const touchesFloor = (tx,ty)=>
    (inB(tx+1,ty)&&at(tx+1,ty)===FLOOR)||(inB(tx-1,ty)&&at(tx-1,ty)===FLOOR)||
    (inB(tx,ty+1)&&at(tx,ty+1)===FLOOR)||(inB(tx,ty-1)&&at(tx,ty-1)===FLOOR);

  /* Which way the door opens. */
  const FACINGS = [['S',0,1],['N',0,-1],['E',1,0],['W',-1,0]];
  function wallFacing(tx, ty, r){
    const open = [];
    for (const [dir,dx,dy] of FACINGS)
      if (inB(tx+dx,ty+dy) && at(tx+dx,ty+dy)===FLOOR) open.push({dir,dx,dy});
    if (!open.length) return 'S';            // unreachable: the slot touches floor
    /* South is not merely a tie-break winner, it is the answer whenever south is
       on the list. A wall with floor both south and east of it is a pillar
       corner that satisfies the slot rule, and the door art has to agree with
       the wall the renderer painted — which is always the south face. Reading
       the corner as an east-facing door put the leaf ninety degrees out of step
       with the lit band behind it. The room-centre sort stays for the case the
       slot rule cannot reach. */
    if (open.some(o=>o.dir==='S')) return 'S';
    if (open.length>1 && r){
      const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
      open.sort((a,b)=>Math.hypot(tx+a.dx-cx, ty+a.dy-cy)-Math.hypot(tx+b.dx-cx, ty+b.dy-cy));
    }
    return open[0].dir;
  }

  /* A slot is only usable if it is a wall with floor DIRECTLY SOUTH of it.
     That is not an aesthetic preference with a geometry excuse attached: it is
     the one orientation the building actually lights. bakeTiles paints a single
     face per wall tile — the south one, sitting in the carpet tile below it — so a door anywhere else is a door standing on a dark
     ceiling top with no lit wall behind it, which reads as a frame painted on
     the floor rather than as a door in a wall. Restricting the slot keeps every
     door in the one place the renderer already knows how to light.

     touchesFloor alone is not enough. A ring tile on the east side of a room
     touches floor to its west, satisfies it, and has no face at all. */
  const southFacing = (tx,ty)=> INTERIOR(tx,ty) && at(tx,ty)===WALL
                                     && INTERIOR(tx,ty+1) && at(tx,ty+1)===FLOOR;

  /* With a dense BSP the ring just outside a room is often another room's floor
     rather than wall, so the ring alone is not enough — hence three escalating
     fallbacks before we give up on a slot. */
  function wallSlotFor(r){
    // 1. the ring immediately around the room
    const ring = [];
    for (let x=r.rx; x<r.rx+r.rw; x++){ ring.push([x,r.ry-1]); ring.push([x,r.ry+r.rh]); }
    for (let y=r.ry; y<r.ry+r.rh; y++){ ring.push([r.rx-1,y]); ring.push([r.rx+r.rw,y]); }
    let cand = ring.filter(([tx,ty]) => southFacing(tx,ty));

    // 2. any interior wall tile with floor south of it, near THIS room
    if (!cand.length){
      const near = [];
      for (let y=r.ry-1; y<=r.ry+r.rh; y++) for (let x=r.rx-1; x<=r.rx+r.rw; x++){
        if (southFacing(x,y)) near.push([x,y]);
      }
      cand = near;
    }
    // 3. any such wall tile anywhere — keeps the level winnable even if the room
    //    is fully walled in by other rooms. Sorted before the slice, so the cap
    //    keeps the nearest USABLE tiles rather than the nearest wall tiles, which
    //    under this rule are not interchangeable.
    if (!cand.length){
      const any = [];
      for (let y=1;y<MAP_H-1 && any.length<4000;y++) for (let x=1;x<MAP_W-1;x++){
        if (southFacing(x,y)) any.push([x,y]);
      }
      // prefer one reasonably near the room it belongs to
      const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
      any.sort((a,b)=>Math.hypot(a[0]-cx,a[1]-cy)-Math.hypot(b[0]-cx,b[1]-cy));
      cand = any.slice(0,60);
    }
    return cand;
  }

  /* THE DOOR. One tile, found from the spawn room, and KNOWN from the first
     frame — there is no hunt for it, because you walked through it. The old
     three-exit economy was a search, and a search cannot survive being given
     a deadline: what this rule replaces is a hunt you spend battery on, and what
     it puts in its place is a journey you spend CLOCK on. You know exactly
     where the door is and the whole question is whether you can get back to it
     in time, which is a question about the floor and not about your radar. */
  const candidates = maze.rooms.filter(r=>r.rw>=6 && r.rh>=6);
  const pool = candidates.length>=6 ? candidates : maze.rooms;
  const entryRoom = pool[0];
  /* The spawn, needed before anything that is placed relative to it — the pipes
     go as far from here as the geometry allows. */
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
  /* Unreachable in practice on a 76x76 BSP: every room has interior wall around
     it. It is here because the alternative is a crash on the level the player
     cannot finish, and there is a clock on that now.

     The old version was a hardcoded (1,1). Under the south-facing rule that tile
     is not guaranteed to be a wall any more — and a door on carpet is worse than
     no door, because everything downstream (the descent, the prompt, the leaf)
     would then be operating on a tile that is not a doorway. So the last resort
     is a whole-map scan for a tile that satisfies the same rule the slot does,
     and only if that comes back empty — which on a map this size cannot happen —
     does the hardcoded tile stand in. */
  if (!exitTiles.length){
    let fb = null;
    outer: for (let y=1; y<MAP_H-1 && !fb; y++)
      for (let x=1; x<MAP_W-1; x++)
        if (southFacing(x,y)){ fb = [x,y]; break outer; }
    if (!fb) fb = [1,1];
    exitTiles.push({x:fb[0], y:fb[1], open:0, facing:'S'});
  }

  /* --- the pipes ------------------------------------------------------
     Each is a single wall tile, as far from the spawn as the floor allows. It
     has to be a WALL and it has to touch walkable floor — you cannot wrench a
     pipe that opens onto solid rock, and you cannot walk to one that opens onto
     nowhere. If the extreme corner turns out to be unusable the search walks
     back toward the spawn rather than failing, because a level with an
     unreachable pipe is unwinnable and every repair is mandatory.

     Preferring the FARTHEST tile and only then falling back means the common
     case is a genuine trek and the rare case is merely a shorter one. With more
     than one pipe the farthest-first rule is applied with PIPE_GAP between
     picks, and the tie broken by the seeded RNG, so four pipes are four corners
     of the building rather than four faces of the same wall. */
  const faceTiles = [];
  for (let y=1;y<MAP_H-1;y++) for (let x=1;x<MAP_W-1;x++){
    if (at(x,y)!==WALL) continue;
    if (!touchesFloor(x,y)) continue;
    faceTiles.push({x, y, d: Math.hypot(x+0.5-spawn.x, y+0.5-spawn.y)});
  }
  faceTiles.sort((a,b)=> b.d - a.d);

  const standSpot = (c) => {
    /* the repair spot: floor the player can actually stand on, flush against
       the pipe. Reachable AND not inside geometry, so the five seconds of the
       repair are physically possible rather than merely intended. */
    for (const [nx,ny] of [[c.x+1,c.y],[c.x-1,c.y],[c.x,c.y+1],[c.x,c.y-1]]){
      if (!inB(nx,ny) || at(nx,ny)!==FLOOR) continue;
      /* The standing spot is the CENTRE of the floor tile beside the pipe.
         The first version of this nudged the position flush against the wall
         face — which is precisely where the player's collision disc already
         puts them, so every candidate was inside its own radius and every
         level fell through to the hardcoded fallback. Standing ON the tile is
         the only legal place to be; how close that counts as "at the pipe" is
         REACH's job, not this function's.

         Checked against the LOCAL grid, not blocked(), because G does not exist
         yet at this point in the level build and blocked() reads G.grid. */
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
  /* The room a standing spot sits in, for the pickup guarantee below. A pipe is
     a wall tile and belongs to no rect; the floor you stand on to reach it does,
     and that is the cell you want beside it. */
  const roomAt = (tx,ty) =>
    maze.rooms.find(r=>tx>=r.rx&&tx<r.rx+r.rw&&ty>=r.ry&&ty<r.ry+r.rh) || null;

  /* The pipes for THIS level. How many is a fixed property of the level, not a
     tuning knob — see LEVELS. */
  const spec = LEVELS[Math.min(floorNum, LEVELS_N-1)];
  const want = spec.leaks;
  const leaks = [];
  const reach = PIPE_FAR[Math.min(want, PIPE_FAR.length)-1];
  const capped = faceTiles.filter(c=>c.d <= reach);
  const shortlist = (capped.length ? capped : faceTiles);
  /* Shallow-to-deep scan of the far half of the level: the first PIPE_GAP-
     separated pick wins, so the pipes come out spread across the building
     while each is still comfortably out of sight of the door.

     The gap is measured between the two STANDING SPOTS, not between the two
     wall tiles. They are not the same question: the wall tile decides where
     the pipe is, and the standing spot is where the player's collision disc
     has to be for the repair to fire at all. Two pipes three wall tiles apart
     can have standing spots 1.0 tile apart, which is inside REPAIR_REACH — and
     then a single five-second hold seals both of them, which is the one thing
     four separate repairs must never be. */
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
  /* A 76x76 BSP level always has interior walls, so this is unreachable in
     practice. It is here because the alternative is a crash on a level the
     player cannot finish, and a soft failure is not acceptable for a mandatory
     objective. */
  while (leaks.length < want){
    const L = { x:1, y:1, sx:1, sy:1, fixed:false, repair:0, fixedAt:0 };
    L.room = entryRoom;
    leaks.push(L);
  }

  /* Pick a floor tile inside a room. Rooms now contain partition stubs, so a
     plain random pick can land inside a wall. `away`/`minD` keep a pickup off
     the player's spawn: a cell sitting under the door you walk in through is
     free battery handed over for nothing, and it was handed over silently
     because nothing about "a battery was collected" looks wrong in isolation. */
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
    /* The fallback is the room's centre, which for the room the player spawns
       in is the spawn itself — so a pickup would land under their boots and be
       collected on frame one, with nothing in the log to say why. Better to
       place no cell than to place one on the player's head. */
    const fb = { x: r.rx + (r.rw>>1), y: r.ry + (r.rh>>1) };
    if (away && Math.hypot(fb.x+0.5-away.x, fb.y+0.5-away.y) < minD) return null;
    return fb;
  };

  /* --- fixtures: ~18% of rooms unlit, some with two panels --- */
  const fixtures = [];
  for (const r of maze.rooms){
    if (r.rw<4 || r.rh<4) continue;
    if (rng() < 0.18) continue;
    const n = (r.rw*r.rh > 260 && rng()<0.4) ? 2 : 1;
    for (let i=0;i<n;i++){
      // radius follows the room, so no room ends up a black hole
      const rad = Math.max(9, Math.min(19, Math.hypot(r.rw, r.rh)*0.62));
      const sp = floorTileIn(r);
      fixtures.push({
        x: sp.x + 0.5,
        y: sp.y + 0.5,
        r: rad * (0.85 + rng()*0.3),
        i: 0.85 + rng()*0.2,
        flicker: rng() < 0.16 ? (0.5 + Math.random()*2.4) : 0,
        phase: rng()*Math.PI*2
      });
    }
  }

  /* --- battery pickups ---
     One is GUARANTEED inside the room the door is in, and one inside the room
     each pipes stands in. The pipe is what the water leads you to, so the cell
     that powers the radar is standing next to the work — with four pipes and
     three minutes you will sweep more than once, and a budget that can run dry
     between the pipe and the pipe is a budget you cannot plan around. */
  const batteries = [];
  const litRooms = maze.rooms.filter(r=>fixtures.some(f=>f.x>=r.rx&&f.x<=r.rx+r.rw&&f.y>=r.ry&&f.y<=r.ry+r.rh));
  const battRooms = new Set();
  for (const b of [{room:entryRoom, away:spawn, d:3}, ...leaks.map(L=>({room:L.room, away:{x:L.sx+0.5,y:L.sy+0.5}, d:1.5}))]){
    const r = b.room;
    if (!r || r.rw<5 || r.rh<5) continue;
    /* Two pipes can share a room, and a stacked pair of cells reads as a bug
       rather than as generosity. One per room. */
    if (battRooms.has(r)) continue;
    battRooms.add(r);
    /* Never within reach of the spawn, and never sitting on the repair spot of
       the pipe this cell belongs to: both are battery you did not have to walk
       for, and the clock is the point of the level. */
    const sp = floorTileIn(r, 1, b.away, b.d);
    if (!sp) continue;
    batteries.push({ x: sp.x+0.5, y: sp.y+0.5, taken:false });
  }
  for (let i=0;i<6+floorNum*2;i++){
    const src = (rng()<0.6 && litRooms.length) ? litRooms : maze.rooms;
    const r = src[(rng()*src.length)|0];
    if (!r || r.rw<4||r.rh<4) continue;
    /* The scatter cells respect the spawn exclusion too. A random pick that
       lands on the player's feet is a pickup they were handed for walking
       through a door, which is worse than no cell at all. */
    const sp = floorTileIn(r, 1, spawn, 3);
    if (!sp) continue;
    batteries.push({ x: sp.x+0.5, y: sp.y+0.5, taken:false });
  }

  /* --- scrawled warnings on the carpet --- */
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
