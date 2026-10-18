import { FLOOR, LEAK_HEADSTART, LEAK_RETREAT, LEAK_SPREAD, MAP_H, MAP_W, WET_EDGE, WET_FALL, WET_RISE } from '../config/constants.js';
import { G } from './state.js';

/* ============================================================
   THE FLOOD
   Water spreads from every open pipe at a fixed rate along walkable floor.
   Nothing else: no pressure model, no pooling, no per-tile diffusion. A distance
   field is the whole physics because water runs downhill, and re-deriving it
   on every state change (rather than advancing a front every frame) means the
   spread can never depend on frame timing — two machines at different frame
   rates flood identically.

   MULTI-SOURCE, and that is a one-word change to the model rather than a
   rewrite: the field is distance to the NEAREST burst, seeded from all of them
   at once, so a tile's target wetness is still exactly `dist <= front` and
   everything downstream — the ordering, the incremental sum, the waterline
   bound — is untouched. Four pipes do not mean four overlapping floods with
   four fronts to reconcile; they mean one flood that started in four places,
   which is what standing water in a building with four burst pipes does.
   ============================================================ */

/* WHICH PART of the image is stale, not just that some of it is. packWet walks
   5776 tiles and writes four bytes each, and it ran that in full on every frame
   the water was moving — which, with a pipe open, is every frame of the level.
   The water moves in a band, though: tickFlood publishes the bounding box of
   what it wrote, seedSplash and initFlood cannot describe a band and publish the
   whole map, and packWet repacks exactly the box and uploads just that rect.

   A dirty box is invalidated by setting the min past the max, so the flag and
   the box cannot disagree: waterDirty true with an empty box is a full repack. */
let wetX0=0, wetY0=0, wetX1=MAP_W-1, wetY1=MAP_H-1;
let wetDirtyX0=-1, wetDirtyY0=-1, wetDirtyX1=-1, wetDirtyY1=-1;
/* Grow the pending box by one tile. Both writers use this — the flood band and
   the player's splashes — so neither can mark the water dirty without also
   saying where. */
function markWetTile(i){
  if (G) G.dirty.water = true;
  const x = i % MAP_W, y = (i / MAP_W) | 0;
  if (x < wetDirtyX0) wetDirtyX0 = x; else if (x > wetDirtyX1) wetDirtyX1 = x;
  if (y < wetDirtyY0) wetDirtyY0 = y; else if (y > wetDirtyY1) wetDirtyY1 = y;
}
function markWetAll(){ if (G) G.dirty.water = true; wetDirtyX0=wetDirtyY0=wetDirtyX1=wetDirtyY1=-1; }

/* The renderer reads the box and repacks it. The box is CONSUMED there: the
   pack is the upload, so after it the pending region is empty and the next
   writer starts a fresh one. An empty box means "repack everything", which is
   what initFlood, a tint change and the first frame after a floor build all
   ask for. */
export function takeWetBox(){
  const full = wetDirtyX1 < 0;
  const box = { full, x0: full?0:wetDirtyX0, y0: full?0:wetDirtyY0,
                x1: full?MAP_W-1:wetDirtyX1, y1: full?MAP_H-1:wetDirtyY1 };
  wetDirtyX0 = wetDirtyY0 = wetDirtyX1 = wetDirtyY1 = -1;
  return box;
}

/* ---------- FLOOD FIELDS (G.wet*) ----------
   G.wetArr is per TILE, 0..1, exactly like G.maskArr: it is state the simulation
   reads and the renderer reads, so there is one number and the wet patch you
   can see is the wet patch that slows your footsteps.

   G.waterDist is a BFS from the leak over walkable floor, recomputed when the
   leak is sealed, and it is the ONLY thing that decides how fast water spreads.
   Derived once per state change rather than simulated per tile per frame:
   water runs downhill, it does not meander, so distance-from-source is exactly
   the physics and a diffusion model would only add a parameter to get wrong. */
/* G.wetByDist is every reachable tile ORDERED BY DISTANCE FROM THE LEAK, and
   G.wetFront is how many of them are currently under water.

   This exists for a measured reason. The first version scanned all 5776 tiles
   every frame, which is correct and cheap-looking and made the headless suite
   take well over twenty minutes instead of seventy seconds — the end-to-end
   bot alone simulates hundreds of thousands of frames.

   But the shape of the problem does not need a scan at all. A tile's target
   wetness is exactly `dist <= front`, so the ONLY tiles whose target differs
   from last frame are the ones in the band the front just moved through. Those
   are contiguous in this ordering, which turns an O(map) pass into an
   O(perimeter of the waterline) pass — a handful of tiles a frame instead of
   six thousand. The ordering is stable because the leak does not move. */
/* G.wetEdgeD is the furthest distance from the nearest pipe at which ANY tile is
   still visibly wet — and it is the bound the per-frame pass actually uses.

   It is not `G.wetFront`, and the difference is the whole recession. `G.wetFront` is
   where the waterline is; the moment the line starts coming back in, every ring
   it has already vacated is still soaking and drying, and those rings are OUTSIDE
   the front. Iterating to the front leaves them stranded at full wetness —
   permanently, because the bound only ever shrinks from there, so a tile dropped
   once is never revisited. The front would walk back to zero on schedule and the
   carpet would not change by a pixel.

   It is also what keeps the pass cheap. A tile at or inside the front is wet, so
   the front is a lower bound on this, and the extra distance it covers is exactly
   the still-drying band — a handful of rings. An unflooded level costs one
   iteration. */
/* BFS distance in tiles from the NEAREST pipe across walkable floor. Derived
   once at level build; during play it is read-only. */
function floodField(){
  const d = new Int32Array(MAP_W*MAP_H).fill(-1);
  const q = [];
  for (const L of G.leaks){
    const s = L.sy*MAP_W + L.sx;
    if (d[s] >= 0) continue;
    d[s] = 0;
    q.push(s);
  }
  /* q comes out of a BFS in non-decreasing distance order already — that is
     what a BFS is — so it IS the G.wetByDist ordering and there is no reason to
     sort it. Carrying that out of the traversal instead of rediscovering it
     later is the whole optimisation. */
  for (let h=0; h<q.length; h++){
    const c = q[h], cx = c%MAP_W, cy = (c/MAP_W)|0;
    for (const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
      if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
      const ni = ny*MAP_W+nx;
      if (G.grid[ni]!==FLOOR || d[ni]>=0) continue;
      d[ni] = d[c]+1;
      q.push(ni);
    }
  }
  return { dist:d, order:q };
}

export function initFlood(){
  G.wetArr = new Float32Array(MAP_W*MAP_H);      // 0 dry .. 1 standing water
  const ff = floodField();
  G.waterDist = ff.dist;
  G.wetByDist = ff.order;                      // BFS order == sorted by distance
  G.wetMaxDist = G.wetByDist.length ? G.waterDist[G.wetByDist[G.wetByDist.length-1]] : 0;
  /* Distance -> first index at or past it. BFS order is sorted, so this is one
     linear pass, and afterwards the waterline bound is an array read. */
  G.wetIndexAtDist = new Int32Array(G.wetMaxDist+2).fill(G.wetByDist.length);
  for (let n=G.wetByDist.length-1; n>=0; n--){
    const d = G.waterDist[G.wetByDist[n]];
    if (d < G.wetIndexAtDist.length) G.wetIndexAtDist[d] = n;
  }
  for (let d=G.wetMaxDist-1; d>=0; d--){
    if (G.wetIndexAtDist[d] > G.wetIndexAtDist[d+1]) G.wetIndexAtDist[d] = G.wetIndexAtDist[d+1];
  }
  G.wetFront = 0;
  G.wetSum = 0;
  G.wetEdgeD = -1;
  G.wetFloor = G.wetByDist.length;
  /* Start the room the player spawns in already damp. Otherwise the first
     seconds of a floor are a pristine yellow carpet with no cue at all, and
     the water reads as a thing that switched on rather than a thing that has
     been running for as long as you have been here. */
  seedSplash(G.player.x, G.player.y, 0.30);

  /* Pre-warm the flood so there is a trail to follow from the first second.
     This is a direct assignment rather than a simulated fast-forward because
     the alternative is stepping tickFlood thousands of times per floor at
     floor build, and the end state is exactly "everything inside the front is
     fully wet", which is what the integration converges to anyway. G.wetSum is
     computed from the same pass, so the incremental sum and the array cannot
     disagree about where they started. */
  {
    const front = Math.min(G.wetMaxDist, LEAK_HEADSTART/LEAK_SPREAD);
    G.wetFront = front;
    let sum = 0;
    /* Every wet tile is at distance <= front, so the edge is known exactly here
       rather than by scanning: this pass is walking them anyway. */
    const hi  = Math.min(G.wetByDist.length-1,
                  G.wetIndexAtDist[Math.min(Math.ceil(front), G.wetIndexAtDist.length-1)]);
    for (let n=0; n<=hi; n++){
      const i = G.wetByDist[n];
      if (G.waterDist[i] <= front){ G.wetArr[i] = 1; sum += 1; }
    }
    G.wetSum = sum;
    /* seedSplash already ran, so the spawn puddle may reach past the pre-warmed
       front — take whichever reaches further. */
    G.wetEdgeD = Math.max(G.wetEdgeD, Math.floor(front));
  }

  G.floodCover = G.wetFloor ? G.wetSum/G.wetFloor : 0;
  /* Packed HERE as well as flagged. initFlood runs inside buildFloor, and
     buildFloor can run in the MIDDLE of a frame — the door rebuilds the floor
     from update() — so the render that follows in that same frame has no pack
     of its own any more, and the fresh G.wetImg (alpha 255, RGB 0) would paint
     black over the new carpet for one frame. */
  if (G) G.dirty.water = true;
  markWetAll();
}

/* Drop a blob of water. Used to seed the floor at spawn and — the reason this
   exists as a function — to ripple outward from the player while they wade,
   so moving through water leaves something behind them. */
export function seedSplash(wx, wy, amount){
  if (!G.wetArr) return;
  const cx = Math.floor(wx), cy = Math.floor(wy);
  for (let y=cy-1;y<=cy+1;y++) for (let x=cx-1;x<=cx+1;x++){
    if (x<0||y<0||x>=MAP_W||y>=MAP_H) continue;
    const i = y*MAP_W+x;
    if (G.grid[i]!==FLOOR) continue;
    const dd = Math.hypot(x+0.5-wx, y+0.5-wy);
    const w = Math.min(1, Math.max(0, amount * (1 - dd/1.8)));
    if (w > G.wetArr[i]){
      G.wetSum += w - G.wetArr[i]; G.wetArr[i] = w;
      markWetTile(i);
      /* A splash can wet a tile further out than the flood has reached — the
         player wading a puddle throws it a tile or two past the waterline. The
         pass is bounded by the wet edge, so a tile raised without moving the
         edge would be one the next tickFlood never looks at: a permanent wet
         spot the player made and cannot dry. */
      if (w > WET_EDGE && G.waterDist[i] > G.wetEdgeD) G.wetEdgeD = G.waterDist[i];
    }
  }
}

/* Wetness under a world point, 0..1. Sampled by the movement code and the
   renderer so "how deep is the water here" is one number, not two. */
export function wetAt(wx, wy){
  if (!G.wetArr) return 0;
  const x=Math.floor(wx), y=Math.floor(wy);
  if (x<0||y<0||x>=MAP_W||y>=MAP_H) return 0;
  return G.wetArr[y*MAP_W+x];
}

/* How much of the reachable floor is currently wet, 0..1. Divided by a FLOOR
   count taken once, not by MAP_W*MAP_H: most of the map is solid rock, and
   dividing by the whole map would report a floor as barely damp when the only
   room in it was underwater. */
/* Sum every wet tile. This is the slow, obviously-correct version and the game
   does NOT call it — tickFlood maintains the same number incrementally as it
   moves the band and leaves it on G.floodCover. It stays because it is the
   ORACLE that the incremental sum is checked against in the test suite, which
   is the only way to know the incremental version has not quietly drifted. */
export function floodCover(){
  if (!G.wetArr || !G.wetFloor) return 0;
  let s=0;
  for (let i=0;i<G.wetArr.length;i++) s += G.wetArr[i];
  return s/G.wetFloor;
}

/* Advance the water one frame.
   The front is at (elapsed / LEAK_SPREAD) tiles from the sources, so a tile's
   target wetness is exactly `dist <= front`. G.wetByDist is sorted by distance,
   so "every tile at or inside the front" is a PREFIX of it.

   Wetness is integrated toward the target with a time constant rather than
   assigned, so the waterline creeps rather than teleporting a tile at a time,
   and a tile the front has just passed is only part wet. */
export function tickFlood(dt){
  if (!G.leaks.length || !G.wetArr) return;

  /* RISING while any pipe is open, FALLING once all are sealed — and NOT at the
     same pace. The waterline goes back out at one tile per LEAK_RETREAT second,
     nearly three times the rate it came in at. That asymmetry is deliberate: the
     flood runs to the far side of the building (G.wetMaxDist is 82-148 tiles out
     depending on the floor), so a symmetric recession is a five to eight minute
     mop-up — longer than FLOOR_CLOCK, and it means walking home through standing
     water for minutes after the objective is already done.

     It used to run at one tile per WET_FALL (7s against an arrival of 3.2), and
     then at exactly LEAK_SPREAD once the two were unified. Both were slower than
     the clock allows. What has to survive any of that is that the recession stays
     RADIAL — derived from the front, not a separate "drain everything" pass — so
     water recedes from the edges inward, away from the pipes, which is what you
     would see on a real level and not what a uniform fade gives you. */
  const prev = G.wetFront;
  const front = G.leaksOpen > 0
    ? Math.min(G.wetMaxDist, prev + dt/LEAK_SPREAD)
    : Math.max(0, prev - dt/LEAK_RETREAT);
  G.wetFront = front;
  /* A STILL FRONT IS NOT SETTLED WATER. The fade is a time constant, so it
     approaches zero without ever arriving, and the only true "nothing to do" is
     an empty edge. Gating the pass on the front alone ended the simulation the
     instant the recession reached the pipes, leaving the last ring or two of
     tiles parked at a few percent wet for the rest of the level — and because
     the front had stopped, nothing would ever come back for them.

     It cost nothing while the water was RISING: the front only stands still
     once it has hit G.wetMaxDist, and by then the whole floor is under water
     anyway. It costs one pass over a shrinking prefix while the floor drains,
     and then the edge empties and this is a single comparison again. */
  if (front === prev && G.wetEdgeD < 0) return;

  /* Every tile at or inside the front still has to integrate toward its
     target — a tile keeps darkening for WET_RISE seconds AFTER the front has
     passed it. The first version updated only the band the front swept, on the
     reasoning that a tile's target only changes there. That reasoning is true
     and the implementation was still wrong: it left every tile stranded at
     about 10% wetness forever, and the floor looked permanently damp rather
     than flooded. The target changes in the band; the approach to it does not.

     What IS worth exploiting is the ordering: everything wet is a contiguous
     PREFIX of G.wetByDist, and nothing past its edge can change. Iterating the
     prefix is bounded by how flooded the level is, and an unflooded one costs
     one iteration. The edge is `G.wetEdgeD` — see the G.wetEdgeD note above floodField() for why it is not the front, and what it cost to get that wrong. */
  const boundD = Math.max(G.wetEdgeD, Math.ceil(Math.max(prev, front)));
  const hi = G.wetIndexAtDist[Math.min(boundD+1, G.wetIndexAtDist.length-1)] - 1;
  if (hi < 0) return;
  const tau = G.leaksOpen>0 ? WET_RISE : WET_FALL;
  const k = 1 - Math.exp(-dt/tau);
  /* A front sitting at zero is no water at all — including on the pipe's own
     standing spot. `dist <= front` says otherwise for distance 0, which pinned
     one tile at full wetness for the rest of the level: a permanent damp patch
     under the pipe you just fixed, in the one place on the floor where the
     player has spent five seconds looking at it. */
  const anyWater = front > 0;
  let sum = G.wetSum;
  let changed = false;
  /* The new edge, computed in the pass that is already walking the tiles rather
     than by a second scan. This is the only place the edge moves, and it moves
     DOWN monotonically once the water starts going out, which is what lets the
     next frame's prefix be smaller than this one's. */
  let edge = -1;
  for (let n=0; n<=hi; n++){
    const i = G.wetByDist[n];
    const cur = G.wetArr[i];
    const target = (anyWater && G.waterDist[i] <= front) ? 1 : 0;
    /* Deliberately not `continue`d on an unchanged tile: the edge has to be
       re-derived from every tile in the prefix, not only from the ones that
       moved this frame. */
    if (cur !== target){
      const next = cur + (target-cur)*k;
      /* A tile that has faded below the edge goes to EXACTLY zero rather than
         parking just under it. It is invisible either way, but a thousand tiles
         left at 1.2% are a thousand tiles the flood gauge never stops counting,
         and a floor that has finished draining would sit at "01" for ever. */
      const snapped = target===0 ? (next <= WET_EDGE ? 0 : next)
                                 : ((1-next) < 0.004 ? 1 : next);
      /* G.wetSum is maintained INCREMENTALLY rather than by re-summing the array
         every frame. It is the numerator of the flood gauge, which is read by
         the leak's own noise level and by the HUD, so it is read a lot; summing
         5776 floats to answer it each time is the same mistake as the scan this
         function used to do, wearing a different hat. */
      sum += snapped - cur;
      G.wetArr[i] = snapped;
      changed = true;
      markWetTile(i);
    }
    if (G.wetArr[i] > WET_EDGE) edge = G.waterDist[i];
  }
  G.wetEdgeD = edge;
  if (!changed) return;
  G.wetSum = sum;
  G.floodCover = G.wetFloor ? Math.max(0, sum/G.wetFloor) : 0;
}