import { hash2 } from '../util/hash.js';
import { MAP_W, MAP_H, WALL, FLOOR } from '../config/constants.js';
export function genMaze(rng){
  const grid = new Uint8Array(MAP_W*MAP_H);       // 0 everywhere = solid
  const rooms = [];
  const doors = [];
  const idx = (x,y)=> y*MAP_W + x;

  const leaves = [];
  /* Subdivision is driven by SIZE, not by a depth counter. A fixed depth ran
     out of budget while cells were still ~18 tiles across, so every floor
     kept at least one room big enough to read as an empty field.
     MAXROOM is a real ceiling: the cut is clamped so a child is never wider
     than its parent, and splitting is refused only once the cell is too
     narrow to divide without producing a closet. Always cut the longer axis
     so children converge on the ceiling instead of drifting past it. */
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
      // vertical partition at column x+cut: a gate straddles COLUMNS at a row
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
      // horizontal partition at row y+cut: a gate straddles ROWS at a column
      const gateCol = () => x + 1 + Math.floor(rng()*Math.max(1,w-2));
      doors.push({axis:'y', cut:y+cut, along:gateCol(), width:2});
      if (rng() < 0.45) doors.push({axis:'y', cut:y+cut, along:gateCol(), width:2});
    }
  })(1,1,MAP_W-2,MAP_H-2,12);

  /* Carve each leaf as a room, inset unevenly so the partitions read as
     temporary site walls rather than a regular grid. Insets are capped: with
     smaller cells an uncapped inset of 3+3 could produce a room wider than
     its cell, which spilled into the partition band and welded two
     neighbouring rooms into one big open space. */
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

  /* Punch doorways through the partition bands.
     The band between two rooms is up to 6 tiles thick, so a 2-tile
     punch would dead-end inside the wall. Instead, tunnel along the
     door column in both directions until we actually break into a
     room floor on each side. */
  for (const d of doors){
    for (let k=0; k<d.width; k++){
      const a = d.along + k;
      if (d.axis === 'x'){
        // vertical partition: tunnel sideways through it, gate spans 2 rows
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
        // horizontal partition: tunnel vertically, gate spans 2 columns
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

  /* Extra partitions inside the larger rooms. The BSP alone still leaves
     some cells big enough to read as an empty field. These stubs add wall
     area and create alcoves WITHOUT dividing a room in two — a full split
     can strand one half, which the connectivity repair would then tunnel
     back through a visible hole in the partition. */
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
          if (Math.abs((y+0.5)-cym) < 1.6) continue;   // leave the spawn clear
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

  /* --- guarantee a single connected region ---
     Belt and braces: flood fill from the biggest room, then tunnel
     from any orphaned region straight into the main one until the
     whole floor is one component. */
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
        // find the closest already-connected tile
        let best=null, bd=1e9;
        for (const m of comps[main]){
          const mx=m%MAP_W, my=(m/MAP_W)|0;
          const d=(mx-cx)**2+(my-cy)**2;
          if (d<bd){ bd=d; best=[mx,my]; }
          if (bd<=4) break;
        }
        if (!best) continue;
        // L-shaped tunnel from (cx,cy) to best
        let x=cx, y=cy;
        while (x!==best[0]){ grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1; x+=Math.sign(best[0]-x); }
        while (y!==best[1]){ grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1; y+=Math.sign(best[1]-y); }
        grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1;
      }
      // refresh main membership with everything we just joined
      for (const c of comps[cid]) if (inMain[c]) comps[main].push(c);
    }
  }

  return { grid, rooms, leaves };
}
