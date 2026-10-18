import { MAP_W, MAP_H } from '../config/constants.js';
import { WALL } from '../config/constants.js';
import { G } from './state.js';

// True if the tile under this point is a wall. Anything off the map counts as a wall.
export const solid = (x,y)=>{
  x = Math.floor(x); y = Math.floor(y);
  return !(x>=0 && y>=0 && x<MAP_W && y<MAP_H) || G.grid[y*MAP_W+x]===WALL;
};

/**
 * Collision test: does a circle overlap any wall tile?
 * Each wall tile is a square, and the circle hits it when the closest point of
 * the square is nearer than the radius.
 *
 * @param {number} x - circle centre, in tiles.
 * @param {number} y
 * @param {number} r - circle radius, in tiles.
 * @returns {boolean} true if the circle is touching a wall.
 */
export function blocked(x,y,r){
  const tx0=Math.floor(x-r), tx1=Math.floor(x+r);
  const ty0=Math.floor(y-r), ty1=Math.floor(y+r);
  for (let ty=ty0; ty<=ty1; ty++){
    for (let tx=tx0; tx<=tx1; tx++){
      if (!solid(tx,ty)) continue;
      const px = x < tx   ? tx : (x > tx+1 ? tx+1 : x);
      const py = y < ty   ? ty : (y > ty+1 ? ty+1 : y);
      const dx = x-px, dy = y-py;
      if (dx*dx + dy*dy < r*r) return true;
    }
  }
  return false;
}

/* If an entity somehow ends up inside a wall, move it to the nearest free
   spot, searching outward in 24 directions. Returns true if it moved. */
export function unstick(e, r){
  if (!blocked(e.x, e.y, r)) return false;
  let bx=null, by=null, bd=Infinity;
  for (let a=0; a<24; a++){
    const ang = a/24*Math.PI*2;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d=0.08; d<=0.9; d+=0.08){
      const nx = e.x+cx*d, ny = e.y+cy*d;
      if (!blocked(nx, ny, r)){ if (d<bd){ bd=d; bx=nx; by=ny; } break; }
    }
  }
  if (bx!==null){ e.x=bx; e.y=by; return true; }
  return false;
}

/* Used when a diagonal move is blocked on both axes: pushes the entity a short
   distance to the nearest free spot, trying directions close to where it was
   heading first. The search is short (0.45 tiles) so it can never teleport. */
export function depenetrate(e, r, dx, dy){
  const want = Math.atan2(dy, dx);
  let bx=null, by=null, bd=Infinity;
  for (let a=-3; a<=3; a++){
    const ang = want + a*(Math.PI/12);
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d=0.08; d<=0.45; d+=0.08){
      const nx = e.x+cx*d, ny = e.y+cy*d;
      if (!blocked(nx, ny, r)){ if (d<bd){ bd=d; bx=nx; by=ny; } break; }
    }
  }
  if (bx!==null){ e.x=bx; e.y=by; return true; }
  return false;
}

/**
 * Moves an entity by (dx, dy), sliding along walls.
 * It tries the full move, then each axis on its own (so you slide along a wall
 * instead of stopping dead), and finally nudges out of a corner.
 *
 * @param {object} e - anything with x and y.
 * @param {number} dx - requested move, in tiles.
 * @param {number} dy
 * @param {number} r - collision radius, in tiles.
 * @returns {number[]} the [dx, dy] actually moved.
 */
export function moveEnt(e, dx, dy, r){
  if (dx===0 && dy===0) return [0,0];

  if (!blocked(e.x+dx, e.y+dy, r)){ e.x+=dx; e.y+=dy; return [dx,dy]; }
  if (dx!==0 && !blocked(e.x+dx, e.y, r)){ e.x+=dx; return [dx,0]; }
  if (dy!==0 && !blocked(e.x, e.y+dy, r)){ e.y+=dy; return [0,dy]; }
  if (dx!==0 && dy!==0) depenetrate(e, r, dx, dy);
  return [0,0];
}