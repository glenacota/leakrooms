import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const blocked = A.blocked;
const buildFloor = A.buildFloor;
const update = A.update;
A.setHeadless(false, false);

/* Three things break the repair mechanic quietly. An unreachable pipe makes the
   floor unwinnable, and no other assertion here would notice because none of
   them needs the repair. Water on a wall draws under the walls, so a wet wall
   tile either disappears or reads as a hole in the lighting. And a pipe that
   reaches LOUD stops being a lure and becomes a level-wide hunt trigger. */
test('leaks are placed on walls, stay reachable, and flood downhill', () => {
  const t = softAssert();
{
  const W=76;

  /* placement, across 30 floors and every riser on each one */
  let unreachable=0, onWall=0, tooClose=0, noSpot=0, sealedAtStart=0, wrongCount=0, pipes=0;
  for (let s=0; s<30; s++){
    buildFloor(s % A.LEVELS_N, s*7907+31);
    const spec = A.LEVELS[s % A.LEVELS_N];
    if (G.leaks.length !== spec.leaks){
      wrongCount++;
      continue;
    }
    for (const L of G.leaks){
      pipes++;
      if (!L){ noSpot++; continue; }
      if (G.grid[L.y*W+L.x] !== 0) onWall++;
      if (L.fixed) sealedAtStart++;

      /* The repair spot must be standable floor inside the map. A pipe the player
         cannot reach makes the level unwinnable, and with a clock running that
         is a lost life, not a puzzle. */
      if (L.sx<0||L.sy<0||L.sx>=W||L.sy>=W || G.grid[L.sy*W+L.sx]!==1) noSpot++;
      if (blocked(L.sx+0.5, L.sy+0.5, 0.33)) unreachable++;

      /* and it should be a real trek, not the tile you spawn on */
      const d = Math.hypot(L.sx+0.5-G.player.x, L.sy+0.5-G.player.y);
      if (d < 8) tooClose++;
    }
  }
  t.assert(wrongCount===0, `${wrongCount}/30 levels built the wrong number of pipes`);
  t.assert(noSpot===0, `${noSpot}/${pipes} pipes have no usable repair spot`);
  t.assert(unreachable===0, `${unreachable}/${pipes} pipes have a repair spot inside geometry`);
  t.assert(onWall===0, `${onWall}/${pipes} pipes are not on a wall tile`);
  t.assert(sealedAtStart===0, `${sealedAtStart} pipes start already sealed`);
  console.log(`  30 levels, ${pipes} pipes: every one on a wall, every repair spot standable`);

  /* water can only exist on floor it can actually reach */
  buildFloor(2, 60606);
  {
    let bad=0, unreachableWet=0;
    for (let i=0;i<W*W;i++){
      if (G.grid[i]===0 && A.internals.waterDist[i] >= 0) bad++;
      if (G.grid[i]===1 && A.internals.waterDist[i] < 0) unreachableWet++;
    }
    t.assert(bad===0, `${bad} wall tiles are inside the water field — water can flow through rock`);
    t.assert(unreachableWet===0, `${unreachableWet} floor tiles the water can never reach`);
    t.assert(G.wetFloor>0, 'the wet floor is empty — the flood gauge would divide by zero');
    console.log(`  water field: ${G.wetFloor} reachable tiles, no wall tiles, none unreachable`);
  }

  /* The field holds distance to the NEAREST riser, so every riser's own spot
     must sit at zero and the field must stay monotone across each floor edge.
     Seeding a second riser without checking whether the first already reached
     it would leave two zero basins and let water arrive in the wrong order. */
  {
    let missing=0, jumps=0;
    for (const L of G.leaks){
      const li = L.sy*W + L.sx;
      if (A.internals.waterDist[li]!==0) missing++;
    }
    t.assert(missing===0,
      `${missing}/${G.leaks.length} pipes do not sit at distance 0 — the field is not seeded from all of them`);
    /* no tile may be closer than a neighbour minus one: a BFS that skipped a
       tile would produce a front that jumps, and the visible symptom is water
       arriving in a distant room before a nearer one. */
    for (let y=1;y<W-1;y++) for (let x=1;x<W-1;x++){
      const i=y*W+x;
      if (G.grid[i]!==1 || A.internals.waterDist[i]<0) continue;
      for (const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){
        const n=ny*W+nx;
        if (G.grid[n]!==1 || A.internals.waterDist[n]<0) continue;
        if (A.internals.waterDist[n] < A.internals.waterDist[i]-1) jumps++;
      }
    }
    t.assert(jumps===0, `${jumps} neighbour pairs violate |d(n)-d(i)|<=1 — the front can skip tiles`);
    console.log(`  distance field seeded from all ${G.leaks.length} pipes and monotone across every floor edge`);
  }

  /* there is a trail from the first second
     The flood is pre-warmed by LEAK_HEADSTART. Without it a floor opens dry and
     the player has no cue until water happens to reach them, which turns the
     opening half-minute into a blind search. */
  {
    let floorsWithTrail=0, dryAtStart=0;
    for (let s=0;s<40;s++){
      buildFloor(s%A.LEVELS_N, s*1543+3);
      let wet=0;
      for (let i=0;i<76*76;i++) if (G.grid[i]===1 && A.internals.wetArr[i]>0.5) wet++;
      if (wet>0) floorsWithTrail++; else dryAtStart++;
      t.assert(G.floodCover>0, `level ${s} starts with a flood gauge reading zero`);
    }
    t.assert(dryAtStart===0,
      `${dryAtStart}/40 levels start bone dry — there is no cue for the first thirty seconds`);
    console.log(`  every level opens with water already standing (${floorsWithTrail}/40)`);
  }

  /* the flood rises, is bounded, and never touches a wall */
  {
    for (let i=0;i<600;i++) update(1/30);      // 20 seconds
    let over=0, wallWet=0, nan=0;
    for (let i=0;i<W*W;i++){
      const v=A.internals.wetArr[i];
      if (Number.isNaN(v)) nan++;
      if (v>1.0001 || v<-0.0001) over++;
      if (G.grid[i]===0 && v>0.02) wallWet++;
    }
    t.assert(nan===0, `${nan} NaN wetness values`);
    t.assert(over===0, `${over} wetness values outside 0..1`);
    t.assert(wallWet===0, `${wallWet} wall tiles are wet — water is rendering through rock`);
    const cover = A.floodCover();
    t.assert(cover>0 && cover<=1, `flood coverage is ${cover}, want (0,1]`);
    console.log(`  after 20s: ${(cover*100).toFixed(0)}% of the floor is wet, no wall is wet`);
  }

  /* The incremental flood gauge agrees with a straight re-sum.
     G.floodCover is maintained by adding the DELTA as the waterline band moves,
     and it is read by the leak's own noise level and by the HUD. An incremental
     sum that drifts leaves the tiles exactly right and the number wrong, which
     shows up as a gauge reading 40% on a dry floor.

     The tolerance is not 1e-6. wetArr is a Float32Array, so every stored value
     is rounded to about 6e-8 and the sum accumulates that once per tile per
     update. What must be ruled out is drift of a different kind, such as a band
     recomputed twice or a splash that skips the sum, and those are orders of
     magnitude larger than the bound below. */
  {
    let worst=0;
    for (let i=0;i<40;i++){
      update(1/30);
      const oracle = A.floodCover();
      worst = Math.max(worst, Math.abs(oracle - G.floodCover));
    }
    const bound = 1e-3;   // eps(2^-24) * 3747 tiles * margin
    t.assert(worst < bound,
      `the incremental flood gauge drifts from a re-sum by ${worst.toExponential(2)} — `+
      `past the float32 rounding bound of ${bound}`);
    console.log(`  incremental flood gauge matches a full re-sum to ${worst.toExponential(1)} (float32 bound)`);
  }

  /* --- the front is CLOSE TO THE LEAK FIRST, and later not.
     This is the cue the whole mechanic rests on: if the water appeared
     everywhere at once the player has nothing to follow. --- */
  {
    let inverted=0;
    for (let i=0;i<W*W;i++){
      const d=A.internals.waterDist[i], w=A.internals.wetArr[i];
      if (d<0) continue;
      /* every tile is wetter than every strictly further tile's distance band:
         aggregate it — mean wetness must strictly decrease with distance. */
      void w;
    }
    const band=6;
    const sum=new Float64Array(64), cnt=new Float64Array(64);
    for (let i=0;i<W*W;i++){
      const d=A.internals.waterDist[i];
      if (d<0) continue;
      const b=Math.min(63,(d/band)|0);
      sum[b]+=A.internals.wetArr[i]; cnt[b]++;
    }
    let prev=Infinity;
    for (let b=0;b<64;b++){
      if (!cnt[b]) continue;
      const mean=sum[b]/cnt[b];
      if (mean > prev + 0.02){ inverted++; }
      prev = Math.max(prev, mean);
    }
    t.assert(inverted===0, `${inverted} distance bands are wetter than the band before them`);
    console.log('  the front is nearest the pipe and falls off with distance');
  }

  /* --- THE WATER GOES AWAY ---
     The recession is the half of this feature that was silently broken for its
     entire life, so this asserts on the WATER and not on the front.

     It passed before, with the floor never changing by a pixel, because it
     measured `wetFront` — the scalar that was edited to make it pass, and which
     moves correctly whatever the tiles do. A front that retreats to zero over a
     carpet that stays soaked is a perfectly consistent system and a completely
     broken feature, and nothing short of looking at wetArr and the packed
     image can tell the two apart.

     Three claims, weakest assumption first:
       1. the waterline goes back at the pace it came in (the front),
       2. a tile the line abandons keeps drying (no stranded ring),
       3. the floor ends up dry — in the array AND in the pixels. */
  {
    A.setHeadless(true, false);
    buildFloor(0, 20250812);
    const N = 76*76;
    const wetCount = ()=>{ let n=0; for(let i=0;i<N;i++) if (A.internals.wetArr[i] > A.WET_DRAW) n++; return n; };
    const drawnTiles = ()=>{
      A.packWet();
      const d = A.internals.wetCv.getContext('2d').getImageData(0,0,76,76).data;
      let n=0; for(let i=0;i<N;i++) if (d[i*4+3] > 8) n++;
      return n;
    };
    /* tickFlood directly: this is about the water, and driving 500 simulated
       seconds through the whole update() to watch a number fall is 10x the cost
       for nothing. The wiring is proved separately, below. */
    const run = (secs)=>{ for (let i=0;i<secs*4;i++) A.tickFlood(0.25); };

    const adv0 = A.internals.wetFront;
    run(60);
    const adv = A.internals.wetFront - adv0;
    const cover0 = G.floodCover, wet0 = wetCount(), px0 = drawnTiles();
    t.assert(wet0 > 200 && px0 > 200 && cover0 > 0.05,
      `the level never actually flooded (${wet0} tiles, ${px0} drawn) — there is nothing to recede`);

    for (const L of G.leaks) A.sealLeak(L);
    t.assert(G.leaksOpen===0, 'the level still has open pipes — nothing to recede from');

    /* 1. the waterline goes out faster than it came in, at the stated rate.

       The window has to be short enough that the front is STILL MOVING when
       the clock stops. A recession long enough to walk the front back past the
       pipes clamps at zero, and a clamped measurement passes at any rate at
       all — it is a tautology, not a test.

       So the window is DERIVED from where the front actually is on this seed
       rather than written down: 60% of the way back to the pipes. Long enough
       to measure a rate, never long enough to clamp, and correct for any value
       of LEAK_RETREAT.

       It used to be a hard-coded 20 seconds, and the reasoning written beside
       it ("the front starts about 32 tiles out, so a full minute would clamp")
       was sound — at LEAK_RETREAT of 1.0, where 20 seconds is 20 tiles and the
       front is still 12 out afterwards. Dropping the constant to 0.5 asked the
       same 20 seconds for 40 tiles of recession from a front 32 tiles out, so
       every run clamped at the pipes and the rate assertion below went on
       reporting the clamp instead of the rate. The comment was right and the
       number went stale under it; deriving it is what keeps the claim honest
       the next time the drain is retuned. */
    const f0 = A.internals.wetFront;
    const T = Math.max(2, Math.min(20, Math.floor(f0 * A.LEAK_RETREAT * 0.6)));
    run(T);
    const rec = f0 - A.internals.wetFront;
    t.assert(Math.abs(adv - 60/A.LEAK_SPREAD) < 0.5,
      `the flood advanced ${adv.toFixed(2)} tiles in 60s, want ${(60/A.LEAK_SPREAD).toFixed(2)}`);
    t.assert(Math.abs(rec - T/A.LEAK_RETREAT) < 0.5,
      `the flood receded ${rec.toFixed(2)} tiles in ${T}s, want ${(T/A.LEAK_RETREAT).toFixed(2)}`);
    t.assert(A.internals.wetFront > 0,
      `the front reached the pipes after ${T}s — the window is too long to measure a rate`);
    t.assert(A.LEAK_RETREAT < A.LEAK_SPREAD,
      `the recession (${A.LEAK_RETREAT}s/tile) is not outrunning the arrival `+
      `(${A.LEAK_SPREAD}s/tile) — the drain is a mop-up again`);
    t.assert(Math.abs(rec - T/A.WET_FALL) > 1,
      'the recession is still running at the old WET_FALL pace');

    /* 2. no stranded ring, measured while there is still a waterline. The tile
       the front abandons FIRST is the one the old bound dropped on the frame it
       was passed, and it is the single tile whose behaviour distinguishes
       "receding" from "the front moved". This has to run before the floor is
       fully drained — once the front hits the pipes every tile is outside it and
       there is no longer anything to compare.

       The tile is picked from the band the front crosses in THIS window —
       outside where the front is now, inside it by the time the window ends.
       Picking it by "some wet tile nearer than the front was" instead put the
       choice at the mercy of the scan order: the lowest flat index in the map
       can be a tile the front has not reached yet, which is still inside the
       waterline and is supposed to be wet. Naming the band makes the claim
       independent of both the seed and the row order. */
    const f1 = A.internals.wetFront;
    const lo = Math.max(0, f1 - T/A.LEAK_RETREAT), hi = f1 - 1;
    let outer=-1;
    for (let i=0;i<N;i++){
      const d = A.internals.waterDist[i];
      if (d > lo && d <= hi && A.internals.wetArr[i] > 0.5){ outer=i; break; }
    }
    t.assert(outer>=0,
      `no wet tile in the band the front crosses next (${lo.toFixed(1)}..${hi.toFixed(1)} tiles) `+
      '— the test cannot see the bug');
    const wOuter = A.internals.wetArr[outer];
    run(T);
    t.assert(A.internals.wetArr[outer] < wOuter*0.7,
      `a tile the waterline abandoned is still at ${A.internals.wetArr[outer].toFixed(2)} — `+
      'it was dropped from the pass and never dried');

    /* 3. and the water is actually going with it — checked on the array AND on
       the packed image, because "the flood recedes" and "the flood is visible
       receding" are different claims and only one of them is the game. */
    run(20);   // long past the point where the front is home, which is the point
    const cover1 = G.floodCover, wet1 = wetCount(), px1 = drawnTiles();
    t.assert(cover1 < cover0*0.7, `coverage only fell ${(cover0*100).toFixed(0)}% -> ${(cover1*100).toFixed(0)}%`);
    t.assert(wet1 < wet0*0.7, `${wet0} wet tiles became ${wet1} — the water is not going anywhere`);
    t.assert(px1 < px0*0.8, `${px0} wet tiles still draw as ${px1} — the image is not drying`);

    /* 4. and it ends up dry */
    run(600);
    t.assert(A.internals.wetFront===0, `the front stopped at ${A.internals.wetFront} instead of returning to the pipes`);
    const wetEnd = wetCount(), pxEnd = drawnTiles();
    t.assert(wetEnd < Math.max(4, wet0*0.02),
      `${wetEnd} of ${wet0} tiles are still wet long after the water should be gone`);
    t.assert(pxEnd < Math.max(4, px0*0.02),
      `${pxEnd} of ${px0} tiles still draw as wet long after the water should be gone`);
    t.assert(G.floodCover < 0.01, `the flood gauge is still reading ${(G.floodCover*100).toFixed(1)}%`);

    /* the whole thing is reachable through the real update(), not only by
       calling the flood directly */
    A.STATE='play'; A.lives=3;
    const before = A.internals.wetFront;
    update(1/30);
    t.assert(A.internals.wetFront < before || A.internals.wetFront===0, 'update() no longer drives the flood');
    A.setHeadless(false, false);
    console.log(`  waterline +${adv.toFixed(1)}/-${rec.toFixed(1)} tiles per 60s; `+
      `${wet0} wet tiles -> ${wet1} -> ${wetEnd}, ${px0} drawn -> ${px1} -> ${pxEnd}`);
  }

  /* --- the leak NEVER gets loud. This is the design contract of the lure —
         and with several pipes open at once it is a contract about the TOTAL,
         not about each one. Four standing sources that are individually quiet
         are collectively the loudest thing in the building if each is allowed
         its own full share, which would turn every late level into a hunt with
         no off switch. --- */
  {
    /* Builds its own level, and level 5, because the claim is about several
       pipes being open at once — and because a block that inherits whatever
       level the block above happened to leave behind is a block whose result
       depends on the order of the file. */
    buildFloor(A.LEVELS_N-1, 60606);
    let loud=0, samples=0;
    for (let i=0;i<1200;i++){
      update(1/30);
      samples++;
      if (G.leakPower >= A.LOUD) loud++;
      if (G.leakPower*G.leaksOpen >= A.LOUD) loud++;
    }
    t.assert(loud===0,
      `the open pipes reached LOUD ${loud}/${samples} samples — a loud leak is a level-wide hunt trigger, not a lure`);
    t.assert(G.leakPower > 0,
      'the open pipes went silent');
    console.log(`  ${G.leaksOpen} open pipes at ${G.leakPower.toFixed(2)} each = `+
      `${(G.leakPower*G.leaksOpen).toFixed(2)} total, against a LOUD of ${A.LOUD} — always a lure`);
  }

  /* --- the leak is audible only when it is quiet: drip < walk < wrench --- */
  {
    t.assert(A.REPAIR_NOISE >= A.LOUD,
      `wrenching at ${A.REPAIR_NOISE} is under LOUD — the repair must be the loud decision`);
    /* THE ORDERING, which the comment above REPAIR_NOISE has claimed since the
       noise table was written and which was never true: the wrench is louder
       than a sprint. It used to be 0.85 against a bare 1.0, so the loudest
       thing on the floor was a run at it — which also meant the meter had no
       top end it could name, and the sprint pegged the bar while the repair,
       the decision the whole stealth layer is built around, sat under it. */
    t.assert(A.SPRINT_NOISE < A.REPAIR_NOISE,
      `sprinting at ${A.SPRINT_NOISE} is louder than the wrench at ${A.REPAIR_NOISE} — `+
      'the repair is not the loud decision');
    t.assert(A.SPRINT_NOISE >= A.LOUD,
      `sprinting at ${A.SPRINT_NOISE} is under LOUD — running past a sleeping coil has to wake it`);
    t.assert(A.SPRINT_NOISE > 0.30,
      `sprinting at ${A.SPRINT_NOISE} is quieter than wading — the sprint stops being a decision`);
    t.assert(A.NOISE_FS === A.REPAIR_NOISE,
      `the meter tops out at ${A.NOISE_FS}, which is not the loudest sustained thing you can do (${A.REPAIR_NOISE})`);
    t.assert(A.LEAK_NOISE_BASE < A.LOUD, 'the base leak noise is already LOUD');
    /* wading must stay UNDER loud or following the trail would be strictly
       worse than sweeping, and the trail has to be the cheap option */
    t.assert(A.LEAK_NOISE_BASE+0.08 < A.LOUD, 'wading is loud enough to wake things');
    console.log(`  wrench ${A.REPAIR_NOISE} > LOUD ${A.LOUD} > drip ${A.LEAK_NOISE_BASE}`);
  }
}
  t.done();
});
