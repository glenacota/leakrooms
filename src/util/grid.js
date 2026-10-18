import { MAP_W, MAP_H } from '../config/constants.js';
import { WALL } from '../config/constants.js';

/* Line of sight between two points, using Bresenham's line algorithm: it walks
   the tiles on the straight line and stops at the first wall. The bake and
   buildFloor share this one version. */
export function makeLos(grid){
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;
  return function los(x0,y0,x1,y1){
    x0=Math.floor(x0); y0=Math.floor(y0); x1=Math.floor(x1); y1=Math.floor(y1);
    let dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
    let sx=x0<x1?1:-1, sy=y0<y1?1:-1, err=dx-dy;
    let guard=0;
    while(guard++ < 400){
      if(x0===x1 && y0===y1) return true;
      const e2 = 2*err;
      if (e2 > -dy){ err -= dy; x0 += sx; }
      if (e2 <  dx){ err += dx; y0 += sy; }
      if (x0===x1 && y0===y1) return true;
      if (!inB(x0,y0) || at(x0,y0)===WALL) return false;
    }
    return false;
  };
}