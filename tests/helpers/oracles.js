export function makeInWall(G){
/* An independent collision oracle: exact circle-vs-tile-AABB, written from
   scratch rather than calling the game's blocked(), so a bug in the game
   cannot hide behind a matching bug in the test. */
function inWall(x, y, r, strict){
  for (let ty=Math.floor(y-r); ty<=Math.floor(y+r); ty++){
    for (let tx=Math.floor(x-r); tx<=Math.floor(x+r); tx++){
      if (tx<0||ty<0||tx>=76||ty>=76) continue;
      if (G.grid[ty*76+tx] !== 0) continue;
      const cx = x<tx?tx:(x>tx+1?tx+1:x);
      const cy = y<ty?ty:(y>ty+1?ty+1:y);
      const dx=x-cx, dy=y-cy;
      const d2 = dx*dx+dy*dy;
      if (strict ? d2 < (r-0.004)*(r-0.004) : d2 < r*r) return true;
    }
  }
  return false;
}
return inWall;
}
