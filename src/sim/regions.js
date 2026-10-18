import { FLOOR, HOP_FALL, MAP_H, MAP_W } from '../config/constants.js';
import { G } from './state.js';

/* Fills G.regionOf, G.regionAdj and G.regionCount from the level's grid and
   rooms. Pure apart from those G fields. */
export function labelRegions(level){
  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  /* --- room regions -------------------------------------------------
     A region is one lit space: a BSP room, or a run of band floor between
     rooms (a gate tunnel). Labelling them is what lets "the room you are in"
     be a well-defined thing at all — the maze is one connected component,
     so a flood fill from the player would light the entire floor and the
     feature would be a no-op.

     Room rects come from disjoint BSP leaves, so they never overlap. The
     partition bands between them are not in any rect, and those tiles are
     flood filled into their own regions: a gate tunnel is a lit space of its
     own, which is exactly right — standing in a doorway lights the doorway,
     not the room behind you. */
  G.regionOf = new Int32Array(MAP_W*MAP_H).fill(-1);
  level.rooms.forEach((r, ri)=>{
    /* FLOOR TILES ONLY. Labelling the whole rect swept up the stub
       partitions that rooms are carved with, and a stub wall then carried its
       room's scope directly and skipped the brightest-neighbour pass below —
       so a wall standing in the middle of your own room rendered darker than
       the floor it bordered. Walls are not lit spaces; they are lit BY the
       spaces around them. Note this also keeps a stub from splitting a room
       into two lit regions, which is what we want: a partition stub is
       furniture, not a doorway. */
    for (let y=r.ry; y<r.ry+r.rh; y++)
      for (let x=r.rx; x<r.rx+r.rw; x++)
        if (at(x,y) === FLOOR) G.regionOf[y*MAP_W+x] = ri;
  });
  let nRegions = level.rooms.length;
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i0=y*MAP_W+x;
    if (at(x,y)!==FLOOR || G.regionOf[i0]>=0) continue;
    const id = nRegions++;
    const stack=[i0]; G.regionOf[i0]=id;
    while (stack.length){
      const c=stack.pop(), cx=c%MAP_W, cy=(c/MAP_W)|0;
      for (const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
        const ni=ny*MAP_W+nx;
        if (at(nx,ny)!==FLOOR || G.regionOf[ni]>=0) continue;
        G.regionOf[ni]=id; stack.push(ni);
      }
    }
  }
  /* adjacency: regions that share a 4-connected floor edge. Two rooms can
     also be neighbours through a band, and a room with two gates has two
     different neighbours — the BFS has to see the real graph, not just
     "the next room over". */
  const regAdj = Array.from({length:nRegions}, ()=>[]);
  const regSeen = new Set();
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const a=G.regionOf[y*MAP_W+x];
    if (a<0) continue;
    for (const [nx,ny] of [[x+1,y],[x,y+1]]){
      if (nx>=MAP_W||ny>=MAP_H) continue;
      const b=G.regionOf[ny*MAP_W+nx];
      if (b<0 || a===b) continue;
      const key = a<b ? a+','+b : b+','+a;
      if (regSeen.has(key)) continue;
      regSeen.add(key);
      regAdj[a].push(b); regAdj[b].push(a);
    }
  }
  G.regionAdj = regAdj;
  G.regionCount = nRegions;
}

/* Region visibility level: how much of the room's own light survives the
   number of gates between you and it. See HOP_FALL. */
export function scopeFor(hops){
  if (hops < 0) return 0;
  return HOP_FALL[Math.min(hops, HOP_FALL.length-1)];
}

export function regionAt(x,y){
  const tx=Math.floor(x), ty=Math.floor(y);
  if (tx<0||ty<0||tx>=MAP_W||ty>=MAP_H) return -1;
  return G.regionOf[ty*MAP_W+tx];
}
