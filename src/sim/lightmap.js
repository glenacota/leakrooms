import { BAKE_FLOOR, FLOOR, MAP_H, MAP_W, WALL } from '../config/constants.js';
import { makeLos } from '../util/grid.js';
import { G } from './state.js';

/* Fills G.lightArr from the level's fixtures and grid. Pure apart from that
   one G field — the pixels are packed out of it by attachFloorImages(). */
export function computeLightArr(level, los){
  const grid = level.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;
  if (!los) los = makeLos(grid);

  /* --- bake ambient light --- */
  G.lightArr = new Float32Array(MAP_W*MAP_H);
  for (const f of level.fixtures){
    const R2 = f.r*f.r;
    const x0=Math.max(0,Math.floor(f.x-f.r)), x1=Math.min(MAP_W-1,Math.ceil(f.x+f.r));
    const y0=Math.max(0,Math.floor(f.y-f.r)), y1=Math.min(MAP_H-1,Math.ceil(f.y+f.r));
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
      const d2=(x+0.5-f.x)**2 + (y+0.5-f.y)**2;
      if (d2>R2) continue;
      if (at(x,y)===WALL) continue;
      if (!los(f.x,f.y,x+0.5,y+0.5)) continue;
      const fall = 1 - Math.sqrt(d2)/f.r;
      const v = Math.min(1, f.i * fall * fall * 1.95);
      const i0 = y*MAP_W+x;
      if (v > G.lightArr[i0]) G.lightArr[i0] = v;
    }
  }
  // 3x3 blur for soft falloff (a wider kernel dilutes single lit tiles
  // into nothing, which leaves the floor pitch black between fixtures)
  const tmp = new Float32Array(G.lightArr);
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    let s=0,n=0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
      const nx=x+dx, ny=y+dy;
      if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
      s+=tmp[ny*MAP_W+nx]; n++;
    }
    G.lightArr[y*MAP_W+x] = s/n;
  }
  /* The ambient floor is high, and that is a change of what this number
     MEANS. It used to be 0.42 because the bake was the only thing deciding
     brightness, so a floor had to stop the darkest corner of a lit room
     collapsing into black. Darkness is now the MASK's job — a room you cannot
     see is multiplied by zero regardless of what its fluorescents are doing.
     So the bake only describes LIT SURFACES, and its floor is set high enough
     that a room you can see shows the palette essentially at full strength,
     with the fixtures as bright pools on top rather than as the only light. */
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i=y*MAP_W+x;
    if (at(x,y)===FLOOR && G.lightArr[i] < BAKE_FLOOR) G.lightArr[i] = BAKE_FLOOR;
  }
  // walls catch light from adjacent floor (their face is visible).
  // This MUST read the post-blur, post-floor values. It used to read `tmp`
  // (pre-blur and pre-ambient-floor), so a wall beside unlit floor got ~0
  // light, multiplied to near-black, and every partition read as a hole in
  // the ground rather than a wall.
  const wallSrc = new Float32Array(G.lightArr);
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i=y*MAP_W+x;
    if (at(x,y)!==WALL) continue;
    let m=0;
    if (inB(x+1,y)&&at(x+1,y)===FLOOR) m=Math.max(m,wallSrc[i+1]);
    if (inB(x-1,y)&&at(x-1,y)===FLOOR) m=Math.max(m,wallSrc[i-1]);
    if (inB(x,y+1)&&at(x,y+1)===FLOOR) m=Math.max(m,wallSrc[i+MAP_W]);
    if (inB(x,y-1)&&at(x,y-1)===FLOOR) m=Math.max(m,wallSrc[i-MAP_W]);
    // a wall deep inside a block still catches some bounce from its room
    G.lightArr[i] = Math.max(m*0.95, BAKE_FLOOR*0.80);
  }
  return G.lightArr;
}
