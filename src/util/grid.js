import { MAP_W, MAP_H, WALL } from '../config/constants.js';
import { walkLine } from './line.js';

/* Line of sight between two points, using Bresenham's line algorithm: it walks
   the tiles on the straight line and stops at the first wall. The bake and
   buildFloor share this one version. */
export function makeLos(grid){
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;
  return function los(x0,y0,x1,y1){
    x0=Math.floor(x0); y0=Math.floor(y0); x1=Math.floor(x1); y1=Math.floor(y1);
    let first=true, visible=false;
    walkLine(x0,y0,x1,y1,(x,y,end)=>{
      if (end){ visible=true; return false; }
      if (first){ first=false; return true; }
      if (!inB(x,y) || at(x,y)===WALL) return false;
    }, {limit:400});
    return visible;
  };
}