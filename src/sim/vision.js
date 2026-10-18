/* ============================================================
   WHAT THE CHARACTER CAN SEE
   The bake (see lightmap.js) says how bright a tile is under its own lights.
   This file decides which of those tiles the player can see right now.

   There is one mask, built in one place (combineMask):
     radar on    everything, at full brightness
     radar off   room scope x distance fade x cone of vision

   The three terms are:
     scope     the room you are in, plus rooms you can look into through gates.
               A BFS over REGIONS (not tiles) decides it, because the far side
               of a 2-tile-wide gate is closer in tiles than the far corner of
               your own room. Region distance is what makes "your room" mean a room.
     distance  fades rooms that are not your own (never your own room)
     cone      a 200 degree fan of rays from the eye, stopped by walls

   The mask can only remove light that the bake provides, never add it.
   ============================================================ */

import {
  DARK_ROOM, FLOOR, HAND_OFF, LIGHT_FADE, LIGHT_FADE_STEPS, MAP_H, MAP_W,
  MASK_TAU, TILE, VIEW_FADE_FAR, VIEW_FADE_NEAR, VIEW_HALF, VIEW_MID,
  VIEW_RANGE, VIEW_RAYS, WALL,
} from '../config/constants.js';
import { view } from '../util/view.js';
import { regionAt, scopeFor } from './regions.js';
import { G } from './state.js';

/* The tests switch the per-frame cone and mask work off with this flag. The
   pixel flag lives in render/pack.js, and setHeadless() in the test API
   switches both with one call. */
export let wantVision = true;
export function setVision(v){ wantVision = !!v; }

/**
 * Is this world point inside the rectangle the renderer draws?
 * It is worked out from the PLAYER's position and not from the renderer's
 * camera, because update() must not read the renderer's state: the tests run
 * update() with no renderer, and the result would silently depend on whether a
 * frame had been drawn. The camera clamp at the map edges is repeated here for
 * the same reason.
 *
 * @param {number} wx - world position, in tiles.
 * @param {number} wy
 * @returns {boolean}
 */
export function onScreen(wx, wy){
  const T = TILE*view.scale;
  const halfW = view.w /(2*T), halfH = view.h /(2*T);
  let cx = G.player.x, cy = G.player.y;
  if (MAP_W > halfW*2) cx = Math.max(halfW, Math.min(MAP_W-halfW, cx));
  if (MAP_H > halfH*2) cy = Math.max(halfH, Math.min(MAP_H-halfH, cy));
  return Math.abs(wx-cx) <= halfW && Math.abs(wy-cy) <= halfH;
}

/* How visible a ceiling light is: the mask value of the tile it hangs over.
   It reads the current mask, so a light fades in smoothly as you turn and does
   not jump to full brightness. */
export function fixtureVis(f){
  const tx=Math.floor(f.x), ty=Math.floor(f.y);
  if (tx<0||ty<0||tx>=MAP_W||ty>=MAP_H) return 0;
  return G.maskArr[ty*MAP_W+tx];
}

/**
 * Casts a fan of rays and marks the tiles they see in `out`.
 * Each ray stops at the first wall. `gain` scales the result, and `fall` is how
 * much brightness is lost at maximum range (0 for none). The cone passes 0: it
 * is only about angles and walls, and brightness falloff is a separate step.
 *
 * Each ray walks the grid one tile at a time (the Amanatides-Woo method). An
 * earlier version sampled at fixed distances and could skip a wall it was only
 * clipping, which lit the pocket behind it. This is also cheaper.
 *
 * @param {Float32Array} out - one value per tile; the best value seen is kept.
 * @param {number} ox - eye position, in tiles.
 * @param {number} oy
 * @param {number} facing - direction of the middle ray, in radians.
 * @param {number} halfAngle - half the width of the fan, in radians.
 * @param {number} range - how far a ray goes, in tiles.
 * @param {number} rays - how many rays make up the fan.
 * @param {number} gain
 * @param {number} fall
 */
export function castFan(out, ox, oy, facing, halfAngle, range, rays, gain, fall){
  const grid=G.grid;
  for (let r=0; r<rays; r++){
    const a = facing - halfAngle + (rays===1 ? 0 : (r/(rays-1))*halfAngle*2);
    const dx=Math.cos(a), dy=Math.sin(a);
    let ix=Math.floor(ox), iy=Math.floor(oy);
    if (ix<0||iy<0||ix>=MAP_W||iy>=MAP_H) continue;
    if (grid[iy*MAP_W+ix]===WALL) continue;    // eye inside a wall: see nothing
    const stepX = dx>0?1:-1, stepY = dy>0?1:-1;
    const invX = dx!==0 ? 1/Math.abs(dx) : Infinity;
    const invY = dy!==0 ? 1/Math.abs(dy) : Infinity;
    let tMaxX = dx!==0 ? (dx>0 ? (ix+1-ox) : (ox-ix)) * invX : Infinity;
    let tMaxY = dy!==0 ? (dy>0 ? (iy+1-oy) : (oy-iy)) * invY : Infinity;
    const tDeltaX = invX, tDeltaY = invY;
    let t = 0;
    while (t <= range){
      if (ix<0||iy<0||ix>=MAP_W||iy>=MAP_H) break;
      const i = iy*MAP_W+ix;
      if (grid[i]===WALL) break;                // the wall blocks the ray
      /* Only mark a tile if the ray passes near its CENTRE (within VIEW_MID),
         not when it just clips a corner. Otherwise you could see a sliver of
         floor around the far side of a wall corner, which is geometrically
         behind the wall. "Visible" means there is a clear line to the middle of
         the tile. */
      const cx=ix+0.5-ox, cy=iy+0.5-oy;
      const tc = cx*dx + cy*dy;                 // closest approach along the ray
      if (tc>=0 && tc<=range){
        const miss2 = cx*cx + cy*cy - tc*tc;    // the ray direction has length 1, so this is the squared miss distance
        if (miss2 <= VIEW_MID*VIEW_MID){
          const v = gain*(1 - fall*Math.min(1, tc/range));
          if (v > out[i]) out[i] = v;
        }
      }
      /* The ray passes exactly through a tile corner. Step both axes, but stop
         if both tiles beside the corner are solid, so a ray cannot slip through
         the diagonal gap between two wall stubs. */
      if (Math.abs(tMaxX-tMaxY) < 1e-9){
        const ax=ix+stepX, ay=iy;
        const bx=ix, by=iy+stepY;
        const sa=(ax<0||ay<0||ax>=MAP_W||ay>=MAP_H)||grid[ay*MAP_W+ax]===WALL;
        const sb=(bx<0||by<0||bx>=MAP_W||by>=MAP_H)||grid[by*MAP_W+bx]===WALL;
        if (sa && sb) break;
        t=tMaxX; tMaxX+=tDeltaX; tMaxY+=tDeltaY; ix=ax; iy=ay;
      } else if (tMaxX < tMaxY){
        t=tMaxX; tMaxX+=tDeltaX; ix+=stepX;
      } else {
        t=tMaxY; tMaxY+=tDeltaY; iy+=stepY;
      }
    }
  }
}

/**
 * Rebuilds the cone of vision (G.coneArr) and folds everything into the target
 * mask. It only does the work when the player's pose changed (position, facing
 * or radar), so standing still costs nothing.
 *
 * The pose test uses the exact position and not the tile. When it used the
 * tile, the vision boundary jumped a whole tile at a time and the world
 * flickered at each tile boundary. Retracing on any movement costs the same
 * per frame and the edge follows you smoothly.
 *
 * @param {boolean} [force] - retrace even if nothing moved.
 * @returns {boolean} true if the cone was rebuilt.
 */
export function traceViewCone(force){
  const p = G.player;
  const tx=Math.floor(p.x), ty=Math.floor(p.y);
  // The radar state is part of the pose: pressing R while standing still must retrace.
  if (!force && p.x===G.coneX && p.y===G.coneY && p.face===G.coneFace && G.radar===G.coneRadar)
    return false;
  G.coneX=p.x; G.coneY=p.y; G.coneFace=p.face; G.coneRadar=G.radar;

  G.coneArr.fill(0);

  const ex = p.x + Math.cos(p.face)*HAND_OFF;
  const ey = p.y + Math.sin(p.face)*HAND_OFF;

  /* The cone has no distance falloff. It is only about angle and walls: within
     100 degrees of where you face, until a wall. An earlier version faded with
     range like a light, so the far corner of your own room was dimmer than the
     tile underfoot. What you can see is bright and what you cannot is black. */
  castFan(G.coneArr, ex, ey, p.face, VIEW_HALF, VIEW_RANGE, VIEW_RAYS, 1, 0);

  // Always see the tile under the player, or backing into a corner (where every ray exits early) would draw the figure in a black hole.
  if (tx>=0&&ty>=0&&tx<MAP_W&&ty<MAP_H) G.coneArr[ty*MAP_W+tx]=1;

  /* Walls: a wall whose face you can see is visible, and takes the brightest
     floor tile it touches, with no dimming. Dimming walls here as well as in the
     bake made them darker than the floor in front of them, which is how a hole
     looks. A wall deep inside a block with nothing lit around it stays black, so
     you cannot see the inside of the building.

     This walks G.wallIdx (the wall tiles only) and not the whole map. The bounds
     checks stay, because a wall on the map edge has no neighbour on one side and
     reading past it would wrap into the next row. */
  const grid=G.grid, cone=G.coneArr, widx=G.wallIdx;
  for (let k=0;k<widx.length;k++){
    const i = widx[k];
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    let m = 0;
    if (x+1<MAP_W   && grid[i+1]===FLOOR)   m=Math.max(m, cone[i+1]);
    if (x>0        && grid[i-1]===FLOOR)   m=Math.max(m, cone[i-1]);
    if (y+1<MAP_H  && grid[i+MAP_W]===FLOOR) m=Math.max(m, cone[i+MAP_W]);
    if (y>0        && grid[i-MAP_W]===FLOOR) m=Math.max(m, cone[i-MAP_W]);
    cone[i] = Math.max(cone[i], m);
  }

  combineMask();
  return true;
}

/**
 * Combines scope, distance fade and cone into the target mask (G.maskTgt).
 * This is separate from traceViewCone because it also has to run when only the
 * room scope changed (during the crossfade) and the cone did not.
 *
 * The radar short-circuits it: sweeping lights the whole floor. That is handled
 * here and not at draw time, so "what can the player see" is decided in one
 * place.
 *
 * The distance fade is skipped for the player's own region (scope 1.0), so the
 * room you stand in is evenly bright wherever you are in it.
 *
 * It loops row by row and carries x and y along, instead of recovering them
 * from the index with a divide and a modulo. This runs 5776 times per frame
 * while moving, and that division was most of its cost. The tests read the
 * result directly, so the output must not change.
 */
export function combineMask(){
  const px2=G.player.x, py2=G.player.y;
  const vis=G.visArr, cone=G.coneArr, tgt=G.maskTgt;
  const fadeSpan = VIEW_FADE_FAR-VIEW_FADE_NEAR;
  let i=0;
  for (let y=0; y<MAP_H; y++){
    const cy = y+0.5-py2;
    for (let x=0; x<MAP_W; x++, i++){
      const sc = vis[i], cn = cone[i];
      let v = 0;
      if (sc > 0 && cn > 0){
        if (sc >= 0.999){
          v = cn;                                   // your own room: no falloff
        } else {
          const dx = x+0.5-px2, dy = cy;
          const d = Math.sqrt(dx*dx + dy*dy);
          const f = d<=VIEW_FADE_NEAR ? 1
                  : d>=VIEW_FADE_FAR  ? 0
                  : (VIEW_FADE_FAR-d)/fadeSpan;
          v = sc*f*cn;
        }
      }
      tgt[i] = v;
    }
  }
  /* The mask is deliberately not blurred. A 3x3 blur once made the player's own
     fully lit tile average with the dark tiles around it (0.55 underfoot), so the
     character stood in a dim spot in the middle of a lit room. Any blur of a field
     with hard zeros in it eats into the lit side of every edge. The mask canvas is
     drawn with bilinear scaling from 76x76 up to full screen, which already
     softens edges across about a tile without leaking. */
  /* Radar: keep the normally visible part fully lit; only the dark part becomes 20% transparent. */
  if (G.radar){
    const tgt = G.maskTgt;
    for (let i=0;i<tgt.length;i++) if (tgt[i] < 0.5) tgt[i] = 0.2;
  }
}

/**
 * Works out which rooms are visible from the room the player is in, and starts
 * a crossfade toward that. `instant` skips the fade (floor start, retry).
 *
 * @param {number} dt - seconds since the last step (currently unused).
 * @param {boolean} instant - jump straight to the new scope.
 * @returns {boolean} true if the room changed.
 */
export function scopeRoomLight(dt, instant){
  const p = G.player;
  const here = regionAt(p.x, p.y);
  if (here === G.visRegion && !instant) return false;

  // Remember the current field so the change fades instead of popping.
  G.visFrom.set(G.visArr);
  G.visRegion = here;
  G.visFadeT  = instant ? 1 : 0;
  G.visStep   = instant ? LIGHT_FADE_STEPS : 0;

  if (here < 0){
    // Off the map (only possible in a broken state): everything dark, since there is nothing to borrow light from.
    G.visTgt.fill(DARK_ROOM);
  } else {
    // BFS over the region graph: how many gates away is each region?
    const hops = new Int32Array(G.regionCount).fill(-1);
    const q = [here];
    hops[here] = 0;
    for (let h=0; h<q.length; h++){
      const r = q[h];
      for (const nb of G.regionAdj[r]) if (hops[nb] < 0){ hops[nb] = hops[r]+1; q.push(nb); }
    }
    for (let i=0; i<G.regionOf.length; i++){
      const r = G.regionOf[i];
      G.visTgt[i] = r < 0 ? -1 : scopeFor(hops[r] < 0 ? 99 : hops[r]);
    }
    /* Solid rock has no region. Scoping by region alone would make every
       partition as dark as DARK_ROOM, including the wall you are leaning on,
       which would look like a black hole in a lit room. So walls take the
       brightest scope of the floor beside them, the same way the bake lights
       them. A wall with no lit neighbour stays dark, which is correct. */
    const src = G.visScratch;
    src.set(G.visTgt);
    for (let y=0; y<MAP_H; y++) for (let x=0; x<MAP_W; x++){
      const i = y*MAP_W+x;
      if (src[i] >= 0) continue;
      let m = DARK_ROOM;
      if (x+1<MAP_W   && src[i+1]   >= 0) m = Math.max(m, src[i+1]);
      if (x>0        && src[i-1]   >= 0) m = Math.max(m, src[i-1]);
      if (y+1<MAP_H  && src[i+MAP_W]>= 0) m = Math.max(m, src[i+MAP_W]);
      if (y>0        && src[i-MAP_W]>= 0) m = Math.max(m, src[i-MAP_W]);
      G.visTgt[i] = m;
    }
  }
  if (instant){
    G.visArr.set(G.visTgt);
    snapMask();
  }
  return true;
}

/* Moves the room crossfade forward. It is done in LIGHT_FADE_STEPS steps over
   LIGHT_FADE seconds, so a room change costs ten repacks and not one per frame. */
export function fadeRoomLight(dt){
  if (G.visStep >= LIGHT_FADE_STEPS) return;
  G.visFadeT = Math.min(1, G.visFadeT + dt/LIGHT_FADE);
  const step = Math.max(G.visStep, Math.ceil(G.visFadeT*LIGHT_FADE_STEPS));
  if (step !== G.visStep){
    G.visStep = step;
    const k = step/LIGHT_FADE_STEPS;
    for (let i=0; i<G.visArr.length; i++) G.visArr[i] = G.visFrom[i] + (G.visTgt[i]-G.visFrom[i])*k;
    // The mask includes the room scope, so it has to be recombined, but only on fade steps and not every frame.
    G.scopeDirty = true;
  }
}

/**
 * Eases the drawn mask toward the freshly calculated one (G.maskTgt).
 * The mask is per tile, so tiles enter and leave the cone one at a time as you
 * walk and the edge of vision would flicker. Approaching the target gradually
 * turns that flicker into a sliding edge. MASK_TAU is much shorter than
 * LIGHT_FADE: this only smooths per-frame noise, while the room crossfade is a
 * deliberate 0.3 s animation of its own.
 *
 * @param {number} dt - seconds since the last step.
 * @returns {boolean} true if the mask moved enough to be worth re-uploading.
 */
export function smoothMask(dt){
  const k = 1 - Math.exp(-dt/MASK_TAU);
  let moved = false;
  for (let i=0; i<G.maskArr.length; i++){
    const d = G.maskTgt[i]-G.maskArr[i];
    if (d > 0.0025 || d < -0.0025){ G.maskArr[i] += d*k; moved = true; }
    else if (d !== 0){ G.maskArr[i] = G.maskTgt[i]; moved = true; }
  }
  return moved;
}

/* Skips the easing and jumps to the settled mask. Used at floor start, on a
   retry, and by the tests, which need the final value and not one 55 ms behind. */
export function snapMask(){
  traceViewCone(true);
  G.maskArr.set(G.maskTgt);
  if (G) G.dirty.mask = true;
}