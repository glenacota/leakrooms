import {
  DARK_ROOM, FLOOR, HAND_OFF, LIGHT_FADE, LIGHT_FADE_STEPS, MAP_H, MAP_W,
  MASK_TAU, TILE, VIEW_FADE_FAR, VIEW_FADE_NEAR, VIEW_HALF, VIEW_MID,
  VIEW_RANGE, VIEW_RAYS, WALL,
} from '../config/constants.js';
import { view } from '../util/view.js';
import { regionAt, scopeFor } from './regions.js';
import { G } from './state.js';

/* The retrace switch lives with the code it switches. setHeadless() in game.js
   owns the pixel flag and calls setVision() here, so the harness still turns
   both off with one call. */
export let wantVision = true;      // traceViewCone + smoothMask retrace per frame
export function setVision(v){ wantVision = !!v; }

/* ============================================================
   ROOM SCOPED VISIBILITY
   The bake answers "how bright is this tile under its own
   fluorescents". These answer "which of those tiles can the
   player see right now" — the room they are standing in, plus
   whatever spills through a gate they can see down.

   A BFS over REGIONS, not tiles. Tile distance would light the
   next room anyway, because a gate tunnel is only 2 tiles wide:
   the far side of a doorway is 3 tiles away, which is closer than
   the far corner of the room you are standing in. Region distance
   is what makes "the room you are in" mean a room.
   ============================================================ */

/* Is this world point inside the rectangle the renderer is drawing?
   Derived from the PLAYER, not from render()'s camera object. update() must
   not read render's mutable state — the headless suite drives update() with no
   renderer at all, and reading a camera that only moves during render would
   silently make the reveal depend on whether a frame had been drawn. The clamp
   is replicated here for exactly that reason: at the edges of the floor the
   camera stops rather than following, and seeing what is genuinely off-screen
   would be worse than a one-frame difference from the smoothing. */
export function onScreen(wx, wy){
  const T = TILE*view.scale;
  const halfW = view.w /(2*T), halfH = view.h /(2*T);
  let cx = G.player.x, cy = G.player.y;
  if (MAP_W > halfW*2) cx = Math.max(halfW, Math.min(MAP_W-halfW, cx));
  if (MAP_H > halfH*2) cy = Math.max(halfH, Math.min(MAP_H-halfH, cy));
  return Math.abs(wx-cx) <= halfW && Math.abs(wy-cy) <= halfH;
}

/* How visible a fixture is right now: the visibility of the tile it hangs
   over, from the combined mask. Sampled from the CURRENT mask, not from a
   target, so a tube does not pop to full brightness the instant you turn. */
export function fixtureVis(f){
  const tx=Math.floor(f.x), ty=Math.floor(f.y);
  if (tx<0||ty<0||tx>=MAP_W||ty>=MAP_H) return 0;
  return G.maskArr[ty*MAP_W+tx];
}

/* ============================================================
   WHAT THE CHARACTER CAN SEE
   One mask, and only one place in the program decides it:

     radar on      everything, full brightness, no cone and no scope
     radar off     room scope x distance x cone

   The radar used to be a torch: a narrow beam that was its own term in this
   mask, because an additive pass drawn after the multiply revealed nothing once
   dark rooms were BLACK — there was no geometry left underneath it. A tool that
   reveals the whole floor does not need to be a beam at all, so it is not one.
   ============================================================ */

/* Fan of rays from (ox,oy) within halfAngle radians of `facing`, stopping at
   the first wall. `gain` scales the result; `fall` is how much brightness is
   lost at maximum range (0 = none). The cone calls it with `fall` of 0 — the
   cone is a statement about angles and occlusion only, and brightness falloff
   is a separate term so the radar can have one and your own room cannot.

   Traversal is an exact voxel walk (Amanatides-Woo), one step per tile
   crossed, NOT a fixed-distance sample. Sampling was subtly wrong in a way
   that only showed up as an assertion failure: a ray stepping every 0.35
   tiles skipped a wall it was clipping for a 0.4-tile sliver, and lit the
   pocket behind it. Fifteen tiles out of 1722 occluded ones, invisible in any
   aggregate brightness number, and exactly the "the cone stops at a wall"
   claim being false. It is also cheaper: one step per tile instead of 2.9. */
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
      if (grid[i]===WALL) break;                // the wall occludes; stop
      /* Only light the tile if the ray passes NEAR ITS CENTRE, not if it
         clips the corner. A voxel walk marks every tile the ray enters, which
         includes the ones it grazes by a few pixels — so you could see a
         one-tile sliver of floor around the far side of a wall corner, a tile
         that is geometrically behind the wall. Requiring the ray to come
         within VIEW_MID of the tile centre makes "visible" mean "there is a
         clear line to the middle of it", which is both what the eye means and
         what the occlusion oracle checks. */
      const cx=ix+0.5-ox, cy=iy+0.5-oy;
      const tc = cx*dx + cy*dy;                 // closest approach along the ray
      if (tc>=0 && tc<=range){
        const miss2 = cx*cx + cy*cy - tc*tc;    // |d| is 1, so this is the squared miss
        if (miss2 <= VIEW_MID*VIEW_MID){
          const v = gain*(1 - fall*Math.min(1, tc/range));
          if (v > out[i]) out[i] = v;
        }
      }
      /* Exact corner: the ray passes precisely through a vertex. Step both
         axes and refuse if both tiles it stepped past are solid, so it cannot
         thread the diagonal pinch between two partition stubs. */
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

/* Rebuild G.coneArr, then fold everything into maskTarget.
   Called only when the pose moved, so standing still costs nothing at all.

   The pose test is on the player's POSITION, not their tile. It used to be on
   the tile, which meant the cone was recomputed about three times a second
   while walking and held still in between — so the boundary of vision jumped a
   whole tile at a time and the world flickered as you crossed each boundary.
   Retracing on any movement costs the same per frame (it was going to run on
   every frame anyway) and the edge now tracks you continuously. */
export function traceViewCone(force){
  const p = G.player;
  const tx=Math.floor(p.x), ty=Math.floor(p.y);
  /* Radar state is part of the pose: pressing R while standing still must
     retrace, or the sweep only appears once you next move. */
  if (!force && p.x===G.coneX && p.y===G.coneY && p.face===G.coneFace && G.radar===G.coneRadar)
    return false;
  G.coneX=p.x; G.coneY=p.y; G.coneFace=p.face; G.coneRadar=G.radar;

  G.coneArr.fill(0);

  const ex = p.x + Math.cos(p.face)*HAND_OFF;
  const ey = p.y + Math.sin(p.face)*HAND_OFF;

  /* The cone has NO distance falloff. It is a statement about ANGLES and
     OCCLUSION only: inside 100 degrees of facing, until a wall. It used to
     fade with range like a light, which put the far corner of a 12-tile room
     at 0.6 while the tile underfoot was at 1.0 — so the room you are standing
     in was a gradient from bright to dim, which is the one thing this feature
     must never do. What you can see is bright; what you cannot is black. */
  castFan(G.coneArr, ex, ey, p.face, VIEW_HALF, VIEW_RANGE, VIEW_RAYS, 1, 0);

  /* One tile of guaranteed visibility under the player. Without it the avatar
     can back into a corner where every ray exits before reaching its own tile
     and the figure renders inside a black hole. */
  if (tx>=0&&ty>=0&&tx<MAP_W&&ty<MAP_H) G.coneArr[ty*MAP_W+tx]=1;

  /* Walls: a wall you can see the face of is visible, and it takes the
     brightest floor it touches — no dimming factor. The mask dimmed walls by
     10% "so they would read as walls", which is backwards: they already read
     as walls because they are a different texture AND the bake floors them at
     80% of the carpet. Dimming them twice in the mask as well left them
     measurably darker than the floor in front, which is the signature of a
     hole rather than a wall. A wall deep inside a block with nothing lit
     around it stays black, which is what you want — you should not be able to
     see the inside of the building. */
  /* Walks G.wallIdx rather than the map: on a floor of mostly masonry this is a
     few hundred iterations instead of 5776 branches, and the same tiles are
     touched in the same order. The bounds checks are still there — a wall on
     the map edge has no neighbour on one side, and reading past the array end
     would be a wrap into the next row. */
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

  /* Fold the three terms into the target mask. The radar short-circuits all of
     them — sweeping lights the whole floor, so there is nowhere left dark.

     The distance term is skipped for the player's own region (scope 1.0), so
     the room you are standing in is uniformly bright no matter which corner
     you are in. Everywhere else it is what turns a long corridor into a
     corridor instead of a lit pipe.

     Split out of traceViewCone because it also has to run when only the ROOM
     SCOPE moved (the crossfade), when the cone itself did not change at all. */
  combineMask();
  return true;
}

/* Fold scope, distance and cone into the target mask.

   The radar short-circuits all of it: sweeping lights the whole floor, so
   every tile is visible and there is nowhere left to hide. That is the entire
   tool. It is handled here rather than at draw time so there is exactly one
   place in the program where "what can the player see" is decided. */
/* Row-major, so `i` walks the same order as before and the output is
   bit-identical — but x and y are carried in the loop instead of recovered from
   `i` with a modulo and a divide. This runs 5776 times per frame while moving,
   and the integer div/mod was most of the cost of a pass that is otherwise
   three array reads and a multiply. Nothing here is allowed to change what it
   computes: the occlusion oracle in the suite reads this field directly. */
export function combineMask(){
  if (G.radar){ G.maskTgt.fill(1); return; }
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
  /* Deliberately NOT blurred. There was a 3x3 pass here and it quietly broke
     the centre of vision: an average of the player's own fully-lit tile with
     the dark tiles around it measured 0.55 underfoot, so the character stood
     in a dimple in the middle of a lit room. Any blur of a field with hard
     zeros in it eats into the lit side of every edge. The mask canvas is
     drawn with bilinear upscaling from 76x76 to full screen, which already
     softens edges across about a tile, and it does it without leaking. */
}

/* Recompute the target visibility field for the region the player is in.
   `instant` skips the crossfade (floor start, retry). */
export function scopeRoomLight(dt, instant){
  const p = G.player;
  const here = regionAt(p.x, p.y);
  if (here === G.visRegion && !instant) return false;

  // snapshot the current field so the change crossfades instead of popping
  G.visFrom.set(G.visArr);
  G.visRegion = here;
  G.visFadeT  = instant ? 1 : 0;
  G.visStep   = instant ? LIGHT_FADE_STEPS : 0;

  if (here < 0){
    // off the map (only possible in a degenerate state): everything dark,
    // walls included — there is nothing to borrow light from
    G.visTgt.fill(DARK_ROOM);
  } else {
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
    /* Solid rock has no region, so scoping by region alone would multiply
       every partition down to DARK_ROOM — including the wall you are standing
       against, whose face and top would read as a black hole punched through
       a lit room. The bake already lights walls from adjacent floor; scope
       them the same way, brightest neighbour wins. A wall deep inside a block
       with no lit neighbour stays dark, which is correct. */
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

/* Advance the crossfade. Quantised: LIGHT_FADE_STEPS repacks over LIGHT_FADE
   seconds, so a room change costs 10 repacks and not one per frame forever. */
export function fadeRoomLight(dt){
  if (G.visStep >= LIGHT_FADE_STEPS) return;
  G.visFadeT = Math.min(1, G.visFadeT + dt/LIGHT_FADE);
  const step = Math.max(G.visStep, Math.ceil(G.visFadeT*LIGHT_FADE_STEPS));
  if (step !== G.visStep){
    G.visStep = step;
    const k = step/LIGHT_FADE_STEPS;
    for (let i=0; i<G.visArr.length; i++) G.visArr[i] = G.visFrom[i] + (G.visTgt[i]-G.visFrom[i])*k;
    /* The mask bakes in the room scope, so it has to be recombined — but only
       on fade steps, not every frame. The easing in smoothMask then tracks it. */
    G.scopeDirty = true;
  }
}

/* Ease the drawn mask toward the freshly traced one.
   The mask is per TILE, so even retraced every frame it is still quantised:
   as you walk, tiles enter and leave the fan one at a time and the boundary of
   vision would chatter. Exponentially approaching the target turns that chatter
   into motion — the edge slides rather than flickers.

   MASK_TAU is deliberately much shorter than LIGHT_FADE. The room crossfade
   is a deliberate 0.3s and is animated in G.visArr; this is only here to take
   the stair-stepping out of a per-frame quantity, so at 55ms it tracks the
   scope closely instead of lagging behind it by a visible amount.

   Returns whether the mask moved enough to be worth re-uploading. */
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

/* Skip the easing entirely — floor start, retry, and every test assertion.
   Anything that reads the mask needs the settled value, not a value 55ms
   behind. */
export function snapMask(){
  traceViewCone(true);
  G.maskArr.set(G.maskTgt);
  if (G) G.dirty.mask = true;
}
