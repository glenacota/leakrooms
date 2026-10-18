import { hash2 } from '../util/hash.js';
import { MAP_W, MAP_H, WALL, FLOOR } from '../config/constants.js';

/**
 * Generates the floor plan: rooms joined by short gates. Steps:
 *   1. Split the map into cells (BSP, "binary space partitioning")
 *   2. Carve a room in each cell
 *   3. Punch gates through the walls between rooms
 *   4. Add small wall stubs inside rooms
 *   5. Make sure everything is one connected area
 *
 * @param {Function} rng - a seeded random number function (0 to 1).
 * @returns {{grid: Uint8Array, rooms: object[], leaves: object[]}} grid has
 *   WALL (0) or FLOOR (1) per tile, and rooms have rx, ry, rw, rh.
 */
export function genMaze(rng){
  const grid = new Uint8Array(MAP_W*MAP_H);       // 0 everywhere = solid
  const rooms = [];
  const doors = [];
  const idx = (x,y)=> y*MAP_W + x;

  const leaves = [];
  /* ---------- Step 1: split into cells ----------
     Splitting is driven by SIZE and not by a fixed depth. A fixed depth ran out
     while cells were still about 18 tiles across, and every floor kept at least
     one room big enough to feel like an empty field.

     MAXROOM is a real ceiling: a cut is clamped so a child is never wider than
     its parent, and splitting is only refused when a cell is too narrow to divide
     without making a closet. The longer axis is always cut, so cells converge
     toward the ceiling and do not drift past it. */
  const MAXROOM = 12, MINCUT = 6;
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
      if (rng() < 0.45) doors.push({axis:'x', cut:x+cut, along:gateRow(), width:2});
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
      if (rng() < 0.45) doors.push({axis:'y', cut:y+cut, along:gateCol(), width:2});
    }
  })(1,1,MAP_W-2,MAP_H-2,12);

  /* ---------- Step 2: carve the rooms ----------
     Each room is inset unevenly in its cell, so the partitions look like
     temporary site walls and not a regular grid. The insets are capped: with
     small cells, an uncapped inset of 3+3 could make a room wider than its
     cell, which spilled into the partition band and joined two rooms into one
     big open space. */
  const MINROOM = 6;
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
     The wall between two rooms can be up to 6 tiles thick, so a fixed 2-tile
     punch would end inside the wall. Instead, tunnel along the gate line in both
     directions until it breaks into room floor on each side. */
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
     The BSP alone still leaves some rooms big enough to feel empty. Short wall
     stubs add wall area and make alcoves without cutting a room in two. (A full
     split could strand one half, and the connection repair below would then
     tunnel back through a visible hole in the wall.) */
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
        const th2 = 1 + (rng() < 0.45 ? 1 : 0);
        for (let y=y0; y<y0+len; y++){
          if (y<L.ry || y>=L.ry+L.rh) continue;
          if (Math.abs((y+0.5)-cym) < 1.6) continue;   // keep the middle clear, where the player may spawn
          for (let k=0;k<th2;k++){
            if (sx+k < L.rx+L.rw) grid[idx(sx+k,y)] = WALL;
          }
        }
      } else {
        const sy = L.ry + 1 + Math.floor(rng()*Math.max(1, L.rh-2));
        const len = 2 + Math.floor(rng()*Math.max(1, L.rw-3));
        const x0 = rng() < 0.5 ? L.rx : L.rx + L.rw - len;
        const th3 = 1 + (rng() < 0.45 ? 1 : 0);
        for (let x=x0; x<x0+len; x++){
          if (x<L.rx || x>=L.rx+L.rw) continue;
          if (Math.abs((x+0.5)-cxm) < 1.6) continue;
          for (let k=0;k<th3;k++){
            if (sy+k < L.ry+L.rh) grid[idx(x,sy+k)] = WALL;
          }
        }
      }
    }
  }

  /* ---------- Step 5: one connected area ----------
     A safety net. Label every connected group of floor, then tunnel from any
     group that is cut off straight toward the main one until the whole floor is
     a single area. */
  const label = new Int32Array(MAP_W*MAP_H).fill(-1);
  const comps = [];
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i0 = idx(x,y);
    if (grid[i0]!==FLOOR || label[i0]>=0) continue;
    const cid = comps.length, stack=[i0], cells=[];
    label[i0]=cid;
    while(stack.length){
      const c = stack.pop(); cells.push(c);
      const cx=c%MAP_W, cy=(c/MAP_W)|0;
      const nb=[c+1,c-1,c+MAP_W,c-MAP_W];
      const ok=[cx<MAP_W-1, cx>0, cy<MAP_H-1, cy>0];
      for(let k=0;k<4;k++){
        if(!ok[k]) continue;
        const ni=nb[k];
        if(grid[ni]===FLOOR && label[ni]<0){ label[ni]=cid; stack.push(ni); }
      }
    }
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

  return { grid, rooms, leaves };
}