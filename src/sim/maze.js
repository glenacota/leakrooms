import { MAP_W, MAP_H, WALL, FLOOR, MIN_WALL } from '../config/constants.js';
import { MAZE_DENSITY } from '../config/tuning.js';
import { traverseFloor } from './path.js';

/* The maze knob. Each lever runs from its value at density 0 (open rooms, many
   loops) to its value at density 1 (small rooms, many dead ends). Density is
   clamped to 0..1 and every lever is rounded, so a given density always gives
   the same layout for a seed. */
const LEVERS = Object.freeze({
  maxRoom:   [12, 8],      // largest BSP cell; rooms never get wider than this
  minRoom:   [6, 4],       // smallest room; below the cell size it leaves a partition between rooms
  gate2:     [0.45, 0.10], // chance a partition gets a second gate
  shortcuts: [6, 2],       // extra loop gates per floor
  islandMin: [60, 30],     // smallest wall block a loop gate may cut off
  openMax:   [12, 7],      // widest open square before it is partitioned
});

/**
 * Resolves every lever at one density.
 *
 * @param {number} density - 0 (open) to 1 (tight).
 * @returns {{maxRoom:number, minRoom:number, gate2:number, shortcuts:number, islandMin:number, openMax:number}}
 */
export function mazeParams(density){
  const d = Math.max(0, Math.min(1, density));
  const at = ([a, b]) => a + (b-a)*d;
  return {
    maxRoom: Math.round(at(LEVERS.maxRoom)), minRoom: Math.round(at(LEVERS.minRoom)),
    gate2: at(LEVERS.gate2), shortcuts: Math.round(at(LEVERS.shortcuts)),
    islandMin: Math.round(at(LEVERS.islandMin)), openMax: Math.round(at(LEVERS.openMax)),
  };
}

/**
 * Connects disconnected floor components with L-shaped tunnels in place.
 * @param {Uint8Array} grid
 */
export function connectComponents(grid){
  const idx = (x,y)=> y*MAP_W + x;
  const label = new Int32Array(MAP_W*MAP_H).fill(-1);
  const comps = [];
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i0 = idx(x,y);
    if (grid[i0]!==FLOOR || label[i0]>=0) continue;
    const cid = comps.length;
    const { order: cells } = traverseFloor(grid, [i0], {depthFirst:true});
    for (const c of cells) label[c]=cid;
    comps.push(cells);
  }
  if (comps.length > 1){
    let main=0;
    for (let c=1;c<comps.length;c++) if (comps[c].length>comps[main].length) main=c;
    const inMain = new Uint8Array(MAP_W*MAP_H);
    for (const c of comps[main]) inMain[c]=1;
    for (let cid=0; cid<comps.length; cid++){
      if (cid===main) continue;
      for (const c of comps[cid]){
        if (inMain[c]) continue;
        const cx=c%MAP_W, cy=(c/MAP_W)|0;
        // Find the closest tile that is already connected
        let best=null, bd=1e9;
        for (const m of comps[main]){
          const mx=m%MAP_W, my=(m/MAP_W)|0;
          const d=(mx-cx)**2+(my-cy)**2;
          if (d<bd){ bd=d; best=[mx,my]; }
          if (bd<=4) break;
        }
        if (!best) continue;
        // An L-shaped tunnel from this tile to the connected one
        let x=cx, y=cy;
        while (x!==best[0]){ grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1; x+=Math.sign(best[0]-x); }
        while (y!==best[1]){ grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1; y+=Math.sign(best[1]-y); }
        grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1;
      }
      // Everything just joined now counts as part of the main area
      for (const c of comps[cid]) if (inMain[c]) comps[main].push(c);
    }
  }
}

/**
 * Generates the floor plan: rooms joined by short gates. Steps:
 *   1. Split the map into cells (BSP, "binary space partitioning")
 *   2. Carve a room in each cell
 *   3. Punch gates through the walls between rooms
 *   4. Add small wall stubs inside rooms
 *   5. Make sure everything is one connected area
 *   6. Remove any wall thinner than MIN_WALL
 *
 * @param {Function} rng - a seeded random number function (0 to 1).
 * @param {number} [density] - 0 (open rooms, loops) to 1 (small rooms, dead ends); defaults to MAZE_DENSITY.
 * @returns {{grid: Uint8Array, rooms: object[], shortcuts: number}} grid has
 *   WALL (0) or FLOOR (1) per tile, and rooms have rx, ry, rw, rh.
 */
export function genMaze(rng, density=MAZE_DENSITY){
  const P = mazeParams(density);
  const grid = new Uint8Array(MAP_W*MAP_H);       // 0 everywhere = solid
  const rooms = [];
  const doors = [];
  const idx = (x,y)=> y*MAP_W + x;

  const leaves = [];
  /* ---------- Step 1: split into cells ----------
     Splitting is driven by SIZE, not by a fixed depth. MAXROOM is a real
     ceiling: a cut is clamped so a child is never wider than its parent, and
     splitting stops when a cell is too narrow to divide without making a
     closet. The longer axis is always cut, so cells converge toward the
     ceiling. */
  const MAXROOM = P.maxRoom, MINCUT = 6;
  (function split(x,y,w,h,depth){
    const tooNarrow = (w < MINCUT*2 && h < MINCUT*2);
    if (depth <= 0 || tooNarrow){
      leaves.push({x,y,w,h,id:leaves.length});
      return;
    }
    if (w >= h){
      if (w < MINCUT*2){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      if (w <= MAXROOM && h <= MAXROOM){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      let cut = Math.round(w*(0.75 + rng()*0.5)/2);
      cut = Math.max(MINCUT, Math.min(w-MINCUT, cut));
      split(x,      y, cut, h, depth-1);
      split(x+cut, y, w-cut, h, depth-1);
      // A vertical partition at column x+cut: its gate is a pair of rows
      const gateRow = () => y + 1 + Math.floor(rng()*Math.max(1,h-2));
      doors.push({axis:'x', cut:x+cut, along:gateRow(), width:2});
      if (rng() < P.gate2) doors.push({axis:'x', cut:x+cut, along:gateRow(), width:2});
    } else {
      if (h < MINCUT*2){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      if (w <= MAXROOM && h <= MAXROOM){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      let cut = Math.round(h*(0.75 + rng()*0.5)/2);
      cut = Math.max(MINCUT, Math.min(h-MINCUT, cut));
      split(x, y,      w, cut, depth-1);
      split(x, y+cut, w, h-cut, depth-1);
      // A horizontal partition at row y+cut: its gate is a pair of columns
      const gateCol = () => x + 1 + Math.floor(rng()*Math.max(1,w-2));
      doors.push({axis:'y', cut:y+cut, along:gateCol(), width:2});
      if (rng() < P.gate2) doors.push({axis:'y', cut:y+cut, along:gateCol(), width:2});
    }
  })(1,1,MAP_W-2,MAP_H-2,12);

  /* ---------- Step 2: carve the rooms ----------
     Each room is inset unevenly in its cell, so the partitions look like
     temporary site walls and not a regular grid. The insets are capped so a
     small cell never produces a room wider than its cell. */
  const MINROOM = P.minRoom;
  const inset = span => 1 + Math.floor(rng()*Math.min(2, Math.max(1, Math.floor((span-MINROOM)/2))));
  for (const L of leaves){
    const ix1 = inset(L.w), ix2 = inset(L.w);
    const iy1 = inset(L.h), iy2 = inset(L.h);
    const rx = L.x+ix1, ry = L.y+iy1;
    const rw = Math.max(MINROOM, L.w-ix1-ix2);
    const rh = Math.max(MINROOM, L.h-iy1-iy2);
    for (let y=ry; y<ry+rh; y++)
      for (let x=rx; x<rx+rw; x++) grid[idx(x,y)] = FLOOR;
    L.rx=rx; L.ry=ry; L.rw=rw; L.rh=rh;
    rooms.push(L);
  }

  /* ---------- Step 3: punch the gates ----------
     The wall between two rooms can be up to 6 tiles thick, so the gate is
     tunneled along the line in both directions until it breaks into room
     floor on each side. */
  for (const d of doors){
    for (let k=0; k<d.width; k++){
      const a = d.along + k;
      if (d.axis === 'x'){
        // Vertical partition: tunnel sideways through it (the gate is 2 rows tall)
        for (let x=d.cut-1, g=0; g<14; x--, g++){
          if (x<1) break;
          grid[idx(x,a)] = FLOOR;
          if (grid[idx(x-1,a)]===FLOOR) break;
        }
        for (let x=d.cut, g=0; g<14; x++, g++){
          if (x>=MAP_W-2) break;
          grid[idx(x,a)] = FLOOR;
          if (grid[idx(x+1,a)]===FLOOR) break;
        }
      } else {
        // Horizontal partition: tunnel vertically (the gate is 2 columns wide)
        for (let y=d.cut-1, g=0; g<14; y--, g++){
          if (y<1) break;
          grid[idx(a,y)] = FLOOR;
          if (grid[idx(a,y-1)]===FLOOR) break;
        }
        for (let y=d.cut, g=0; g<14; y++, g++){
          if (y>=MAP_H-2) break;
          grid[idx(a,y)] = FLOOR;
          if (grid[idx(a,y+1)]===FLOOR) break;
        }
      }
    }
  }

  /* ---------- Step 4: wall stubs inside rooms ----------
     Short wall stubs add wall area and make alcoves without cutting a room in two. */
  for (const L of rooms){
    if (L.rw < 6 && L.rh < 6) continue;
    const cym = L.ry + L.rh/2;
    const cxm = L.rx + L.rw/2;
    const stubs = 1 + (rng() < 0.65 ? 1 : 0) + (rng() < 0.3 ? 1 : 0);
    for (let n=0; n<stubs; n++){
      if (L.rw >= L.rh){
        const sx = L.rx + 1 + Math.floor(rng()*Math.max(1, L.rw-2));
        const len = 2 + Math.floor(rng()*Math.max(1, L.rh-3));
        const y0 = rng() < 0.5 ? L.ry : L.ry + L.rh - len;
        rng();                                          // was the thickness roll; kept so the seeded sequence is unchanged
        // Grow from the room wall the stub hangs off, and stop at the clear middle, so no loose piece is left behind.
        const dir = y0 === L.ry ? 1 : -1;
        const ys = [];
        for (let n2=0, y=dir>0 ? y0 : y0+len-1; n2<len; n2++, y+=dir){
          if (y<L.ry || y>=L.ry+L.rh) break;
          if (Math.abs((y+0.5)-cym) < 1.6) break;   // keep the middle clear, where the player may spawn
          ys.push(y);
        }
        if (ys.length < MIN_WALL) continue;
        for (const y of ys) for (let k=0;k<MIN_WALL;k++){
          if (sx+k < L.rx+L.rw) grid[idx(sx+k,y)] = WALL;
        }
      } else {
        const sy = L.ry + 1 + Math.floor(rng()*Math.max(1, L.rh-2));
        const len = 2 + Math.floor(rng()*Math.max(1, L.rw-3));
        const x0 = rng() < 0.5 ? L.rx : L.rx + L.rw - len;
        rng();                                          // was the thickness roll
        const dir = x0 === L.rx ? 1 : -1;
        const xs = [];
        for (let n2=0, x=dir>0 ? x0 : x0+len-1; n2<len; n2++, x+=dir){
          if (x<L.rx || x>=L.rx+L.rw) break;
          if (Math.abs((x+0.5)-cxm) < 1.6) break;
          xs.push(x);
        }
        if (xs.length < MIN_WALL) continue;
        for (const x of xs) for (let k=0;k<MIN_WALL;k++){
          if (sy+k < L.ry+L.rh) grid[idx(x,sy+k)] = WALL;
        }
      }
    }
  }

  /* ---------- Step 5: one connected area ----------
     A safety net. Label every connected group of floor, then tunnel from any
     group that is cut off straight toward the main one until the whole floor is
     a single area. */
  connectComponents(grid);

  /* Thinning and island removal feed each other (deleting an island can leave a
     neighbour thin, and thinning can cut a stub loose), so they repeat until
     neither changes anything. The cap is a safety net, not an expected limit. */
  const settle = ()=>{
    for (let pass=0; pass<40; pass++){
      const before = grid.join('');
      thinWalls(grid);
      joinIslands(grid);
      if (grid.join('') === before) break;
    }
    // Bridging and thinning can undo each other; deleting only adds floor, so this settles.
    for (let prev=''; grid.join('')!==prev;){ prev = grid.join(''); thinWalls(grid); joinIslands(grid, false); }
  };
  settle();
  // Partitioning adds walls, which settle() may bridge or trim, so alternate until quiet.
  for (let pass=0; pass<60 && splitHalls(grid, P.openMax); pass++) settle();

  // Last: gates only add floor, and the final settle only deletes, so they survive.
  const { made: shortcuts, keep } = addShortcuts(grid, P.shortcuts, P.islandMin);
  for (let prev=''; grid.join('')!==prev;){ prev = grid.join(''); thinWalls(grid); joinIslands(grid, false, keep); }

  return { grid, rooms, shortcuts };
}

/* The smallest wall block a shortcut gate may leave cut off from the border, at density 0. */
export const ISLAND_MIN = LEVERS.islandMin[0];
/* A wall at most this thick is worth a gate. Thicker would be a long tunnel. */
const GATE_MAX = 4;
/* A gate must save at least this many steps of walking, or it is not a shortcut. */
const SHORTCUT_MIN = 30;

/**
 * Punches extra 2 wide gates through thin walls where they save the most
 * walking. This turns the tree of rooms into a graph with loops, so a chased
 * player has more than one way out. Each round picks the wall segment whose gate
 * shortens the walk between its two sides the most (ties go to the lowest
 * position), and stops when none saves SHORTCUT_MIN steps. No random numbers.
 *
 * @param {Uint8Array} grid - modified in place.
 * @param {number} [maxGates] - at most this many gates.
 * @param {number} [islandMin] - smallest block a gate may cut off.
 * A gate that closes a loop must wall in a block, so that block becomes an island.
 * That is allowed when the block has at least ISLAND_MIN tiles (a building, not a
 * stub); `keep` marks those tiles so island removal leaves them alone.
 *
 * @returns {{made:number, keep:Uint8Array}} gates punched, and the protected wall blocks.
 */
export function addShortcuts(grid, maxGates=LEVERS.shortcuts[0], islandMin=ISLAND_MIN){
  const N = MAP_W*MAP_H;
  const dist = new Int16Array(N);
  const queue = new Int32Array(N);
  const stamp = new Int32Array(N);
  let tag = 0;
  // Walking steps from a to b, or the limit if farther. Search stops at the limit.
  const walk = (a, b, limit)=>{
    tag++;
    let head=0, tail=0;
    queue[tail++] = a; stamp[a] = tag; dist[a] = 0;
    while (head<tail){
      const c = queue[head++];
      if (c === b) return dist[c];
      if (dist[c] >= limit) continue;
      const x=c%MAP_W, y=(c/MAP_W)|0;
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx, ny=y+dy;
        if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
        const k=ny*MAP_W+nx;
        if (grid[k]===FLOOR && stamp[k]!==tag){ stamp[k]=tag; dist[k]=dist[c]+1; queue[tail++]=k; }
      }
    }
    return limit;
  };

  // Wall tiles that no longer reach the border ring through wall tiles.
  const strandedWalls = ()=>{
    tag++;
    let head=0, tail=0;
    for (let i=0; i<N; i++){
      if (grid[i]!==WALL) continue;
      const x=i%MAP_W, y=(i/MAP_W)|0;
      if (x===0||y===0||x===MAP_W-1||y===MAP_H-1){ stamp[i]=tag; queue[tail++]=i; }
    }
    while (head<tail){
      const c = queue[head++], x=c%MAP_W, y=(c/MAP_W)|0;
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx, ny=y+dy;
        if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
        const k=ny*MAP_W+nx;
        if (grid[k]===WALL && stamp[k]!==tag){ stamp[k]=tag; queue[tail++]=k; }
      }
    }
    const out = [];
    for (let i=0; i<N; i++) if (grid[i]===WALL && stamp[i]!==tag) out.push(i);
    return out;
  };
  // Every stranded piece must be a block of at least ISLAND_MIN tiles
  const bigEnough = (tiles)=>{
    const set = new Set(tiles);
    while (set.size){
      const first = set.values().next().value;
      const st = [first]; set.delete(first); let n = 0;
      while (st.length){
        const c = st.pop(); n++;
        const x=c%MAP_W, y=(c/MAP_W)|0;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const k=(y+dy)*MAP_W+x+dx;
          if (set.delete(k)) st.push(k);
        }
      }
      if (n < islandMin) return false;
    }
    return true;
  };

  const LIMIT = 80;
  let made = 0;
  const keep = new Uint8Array(N);
  for (; made<maxGates; made++){
    const cands = [];
    for (let y=2; y<MAP_H-3; y++) for (let x=2; x<MAP_W-3; x++){
      for (const [dx,dy] of [[1,0],[0,1]]){
        // px,py: the step to the parallel lane that makes the gate 2 wide
        const px = dy, py = dx;
        const a = y*MAP_W+x, a2 = (y+py)*MAP_W+x+px;
        if (grid[a]!==FLOOR || grid[a2]!==FLOOR) continue;
        let t = 0;
        while (t<=GATE_MAX){
          const i = (y+dy*(t+1))*MAP_W+x+dx*(t+1), j = i+py*MAP_W+px;
          if (grid[i]!==WALL || grid[j]!==WALL) break;
          t++;
        }
        if (t<1 || t>GATE_MAX) continue;
        const ex = x+dx*(t+1), ey = y+dy*(t+1);
        if (ex>=MAP_W-1 || ey>=MAP_H-1) continue;
        // The wall must stay MIN_WALL thick on both sides of the gate, or thinWalls would eat it
        let solid = true;
        for (let k=1; k<=t && solid; k++) for (const o of [-2,-1,2,3]){
          const wx = x+dx*k+px*o, wy = y+dy*k+py*o;
          if (wx<0||wy<0||wx>=MAP_W||wy>=MAP_H || grid[wy*MAP_W+wx]!==WALL) solid = false;
        }
        if (!solid) continue;
        const b = ey*MAP_W+ex, b2 = (ey+py)*MAP_W+ex+px;
        if (grid[b]!==FLOOR || grid[b2]!==FLOOR) continue;
        const d = walk(a, b, LIMIT);
        if (d >= SHORTCUT_MIN) cands.push({ x, y, dx, dy, px, py, t, d });
      }
    }
    cands.sort((u,v)=> v.d-u.d || u.y-v.y || u.x-v.x || u.dx-v.dx);
    const carve = (c, to)=>{
      for (let k=1; k<=c.t; k++){
        grid[(c.y+c.dy*k)*MAP_W+c.x+c.dx*k] = to;
        grid[(c.y+c.dy*k+c.py)*MAP_W+c.x+c.dx*k+c.px] = to;
      }
    };
    let best = null;
    for (const c of cands){
      carve(c, FLOOR);
      const stranded = strandedWalls();
      if (bigEnough(stranded)){ best = c; for (const i of stranded) keep[i] = 1; break; }
      carve(c, WALL);
    }
    if (!best) break;
  }
  return { made, keep };
}

/**
 * Cuts any all-floor square wider than openMax with a MIN_WALL thick partition.
 * The partition runs along the square's middle, extends in both directions until
 * it meets a wall, and leaves a 2 wide gap at the middle so the floor stays one
 * area. Tries both axes; a square that cannot be cut without splitting the floor
 * is skipped. Splits one square per call. No random numbers are used.
 *
 * @param {Uint8Array} grid - modified in place.
 * @param {number} [openMax] - the widest open square allowed.
 * @returns {boolean} true if a partition was added.
 */
export function splitHalls(grid, openMax=LEVERS.openMax[0]){
  const N = MAP_W*MAP_H;
  const d = new Int16Array(N);
  const squares = [];
  for (let y=0; y<MAP_H; y++) for (let x=0; x<MAP_W; x++){
    const i = y*MAP_W+x;
    if (grid[i]!==FLOOR) continue;
    d[i] = (x&&y) ? 1+Math.min(d[i-1], d[i-MAP_W], d[i-MAP_W-1]) : 1;
    if (d[i] > openMax) squares.push({ x0:x-d[i]+1, y0:y-d[i]+1, s:d[i] });
  }
  squares.sort((a,b)=> b.s-a.s || a.y0-b.y0 || a.x0-b.x0);

  const parts = ()=>{
    const seen = new Uint8Array(N); let n = 0;
    for (let i=0; i<N; i++){
      if (grid[i]!==FLOOR || seen[i]) continue;
      n++; const st=[i]; seen[i]=1;
      while (st.length){
        const c=st.pop(), x=c%MAP_W, y=(c/MAP_W)|0;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const nx=x+dx, ny=y+dy;
          if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
          const k=ny*MAP_W+nx;
          if (grid[k]===FLOOR && !seen[k]){ seen[k]=1; st.push(k); }
        }
      }
    }
    return n;
  };
  const before = parts();

  for (const { x0, y0, s } of squares){
    for (const vertical of [true, false]){
      const mid = Math.floor(s/2) - 1;
      const line = [];
      // a = along the partition, c = across it
      const a0 = vertical ? y0 : x0, c0 = (vertical ? x0 : y0) + mid;
      const at = (a,c)=> vertical ? (a<0||a>=MAP_H||c<0||c>=MAP_W ? -1 : a*MAP_W+c)
                                  : (a<0||a>=MAP_W||c<0||c>=MAP_H ? -1 : c*MAP_W+a);
      const open = (a)=> { for (let w=0; w<MIN_WALL; w++){ const i=at(a,c0+w); if (i<0 || grid[i]!==FLOOR) return false; } return true; };
      let lo = a0, hi = a0+s-1;
      while (open(lo-1)) lo--;
      while (open(hi+1)) hi++;
      const gap0 = a0 + mid;
      for (let a=lo; a<=hi; a++){
        if (a>=gap0 && a<gap0+2) continue;
        for (let w=0; w<MIN_WALL; w++) line.push(at(a,c0+w));
      }
      if (line.some(i=> i<0)) continue;
      for (const i of line) grid[i] = WALL;
      if (parts() <= before) return true;
      for (const i of line) grid[i] = FLOOR;
    }
  }
  return false;
}

/* An island of at most this many tiles is a stub or a pillar: it is simply
   deleted. A bigger one is a piece of partition, and deleting it would merge the
   rooms around it into one huge hall, so it is bridged to the wall instead. */
const ISLAND_SMALL = 0;
/* The longest bridge, in tiles of floor to fill. A longer one would cut a room
   in two, so the island is deleted instead. */
const BRIDGE_MAX = 10;

/**
 * Removes "wall islands": groups of wall tiles that do not touch the outer wall
 * through edge-adjacent wall tiles (a diagonal touch is not a link, since it
 * reads as two separate blocks). Small islands are deleted. Large ones are joined
 * to the nearest connected wall with a MIN_WALL thick bridge, unless that would
 * split the floor or needs a long bridge, in which case they are deleted too.
 * Deleting only ever adds floor, so it cannot disconnect anything. No random
 * numbers are used.
 *
 * @param {Uint8Array} grid - modified in place.
 * @param {boolean} [bridge=true] - false deletes every island instead of bridging it.
 * @param {Uint8Array|null} [keep] - islands containing a marked tile are left alone.
 */
export function joinIslands(grid, bridge=true, keep=null){
  const N = MAP_W*MAP_H;
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
  const onBorder = i => { const x=i%MAP_W, y=(i/MAP_W)|0; return x===0||y===0||x===MAP_W-1||y===MAP_H-1; };

  // Flood the wall from the border; whatever it does not reach is an island.
  const anchored = new Uint8Array(N);
  const flood = (seeds, mark, stopAt=null)=>{
    const out = [], stack = seeds.slice();
    for (const s of seeds) mark[s] = 1;
    while (stack.length){
      const c = stack.pop(); out.push(c);
      const x=c%MAP_W, y=(c/MAP_W)|0;
      for (const [dx,dy] of DIRS){
        const nx=x+dx, ny=y+dy;
        if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
        const n=ny*MAP_W+nx;
        if (grid[n]===WALL && !mark[n] && !(stopAt && stopAt[n])){ mark[n]=1; stack.push(n); }
      }
    }
    return out;
  };
  const borderSeeds = [];
  for (let i=0;i<N;i++) if (grid[i]===WALL && onBorder(i)) borderSeeds.push(i);
  flood(borderSeeds, anchored);

  const floorParts = ()=>{
    const seen = new Uint8Array(N); let parts = 0;
    for (let i=0;i<N;i++){
      if (grid[i]!==FLOOR || seen[i]) continue;
      parts++; const stack=[i]; seen[i]=1;
      while (stack.length){
        const c=stack.pop(), x=c%MAP_W, y=(c/MAP_W)|0;
        for (const [dx,dy] of DIRS){
          const nx=x+dx, ny=y+dy;
          if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
          const n=ny*MAP_W+nx;
          if (grid[n]===FLOOR && !seen[n]){ seen[n]=1; stack.push(n); }
        }
      }
    }
    return parts;
  };

  const claimed = new Uint8Array(N);
  for (let i=0;i<N;i++){
    if (grid[i]!==WALL || anchored[i] || claimed[i]) continue;
    const island = flood([i], claimed, anchored);
    if (keep && island.some(c=> keep[c])) continue;

    let link = null;
    if (bridge && island.length > ISLAND_SMALL){
      const mine = new Set(island);
      for (const c of island){
        const x=c%MAP_W, y=(c/MAP_W)|0;
        for (const [dx,dy] of DIRS){
          let n=0, cx=x+dx, cy=y+dy;
          while (n<=BRIDGE_MAX && cx>0 && cy>0 && cx<MAP_W-1 && cy<MAP_H-1 && grid[cy*MAP_W+cx]===FLOOR){ n++; cx+=dx; cy+=dy; }
          if (n===0 || n>BRIDGE_MAX) continue;
          const hit = cy*MAP_W+cx;
          if (cx<0||cy<0||cx>=MAP_W||cy>=MAP_H || !anchored[hit] || mine.has(hit)) continue;
          if (!link || n < link.n) link = { x, y, dx, dy, n };
        }
      }
    }

    if (link){
      const parts = floorParts();
      const filled = [];
      for (let k=1; k<=link.n; k++){
        // MIN_WALL wide: the bridge itself and the lines beside it
        for (let w=0; w<MIN_WALL; w++){
          const bx = link.x + link.dx*k + (link.dx===0 ? w : 0);
          const by = link.y + link.dy*k + (link.dy===0 ? w : 0);
          if (bx<1||by<1||bx>=MAP_W-1||by>=MAP_H-1) continue;
          const bi = by*MAP_W+bx;
          if (grid[bi]===FLOOR){ grid[bi]=WALL; filled.push(bi); }
        }
      }
      if (floorParts() <= parts){
        for (const c of island) anchored[c] = 1;
        for (const bi of filled) anchored[bi] = 1;
        continue;
      }
      for (const bi of filled) grid[bi] = FLOOR;
    }
    for (const c of island) grid[c] = FLOOR;
  }
}

/**
 * Removes every wall tile that belongs to a run thinner than MIN_WALL, in either
 * direction, so a partition, rib or stub is never a hairline. A wall tile is
 * kept only if its horizontal run and its vertical run are both long enough.
 * The pass only ever turns wall into floor, so it cannot disconnect anything,
 * and it repeats because deleting a tile can leave its neighbours thin. It uses
 * no random numbers. The outer ring of the map is never touched.
 *
 * @param {Uint8Array} grid - modified in place.
 */
export function thinWalls(grid){
  const at = (x,y)=> x<0||y<0||x>=MAP_W||y>=MAP_H ? FLOOR : grid[y*MAP_W+x];
  const run = (x,y,dx,dy)=>{
    let n = 1;
    for (let i=1; at(x+dx*i,y+dy*i)===WALL; i++) n++;
    for (let i=1; at(x-dx*i,y-dy*i)===WALL; i++) n++;
    return n;
  };
  for (let changed=true; changed;){
    changed = false;
    const doomed = [];
    for (let y=1; y<MAP_H-1; y++) for (let x=1; x<MAP_W-1; x++){
      if (grid[y*MAP_W+x]!==WALL) continue;
      if (run(x,y,1,0) < MIN_WALL || run(x,y,0,1) < MIN_WALL) doomed.push(y*MAP_W+x);
    }
    for (const i of doomed){ grid[i] = FLOOR; changed = true; }
  }
}