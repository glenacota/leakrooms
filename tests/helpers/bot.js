/* Shared bot navigation helpers (verbatim from the playthrough tests). */
export function bfsPath(sx, sy, gx, gy, grid, W, H){
  if(sx===gx && sy===gy) return [];
  const IDX=(x,y)=>y*W+x;
  const prev=new Int32Array(W*H).fill(-1);
  const st=IDX(sx,sy), goal=IDX(gx,gy);
  if(grid[st]!==1||grid[goal]!==1) return null;
  prev[st]=st; const q=[st];
  for(let h=0;h<q.length;h++){
    const c=q[h];
    if(c===goal) break;
    const cx=c%W, cy=(c/W)|0;
    for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
      if(nx<0||ny<0||nx>=W||ny>=H) continue;
      const ni=ny*W+nx;
      if(grid[ni]!==1||prev[ni]>=0) continue;
      prev[ni]=c; q.push(ni);
    }
  }
  if(prev[goal]<0) return null;
  const out=[]; let c=goal;
  while(c!==st){ out.push([c%W,(c/W)|0]); c=prev[c]; }
  out.push([sx,sy]);
  return out.reverse();
}
