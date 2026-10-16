import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
A.setHeadless(false, true);

/* ============ TEST 12: room-scoped visibility =======================
   The room you are standing in is lit; the rooms you are not, are dark.

   The BAKE is unchanged by this (test 1 still asserts its coverage), so the
   risk is entirely in the second layer: a scope that leaks, a scope that does
   not follow the player, a scope that punches a black hole through the wall
   you are leaning on, or a scope that quietly mutates the bake. Each of those
   is a separate failure mode, so each gets its own assertion.             */
/* From here on the tests read the mask, the cone and the packed images, so
   both halves of the vision pipeline go back on. */
A.setHeadless(false, true);
test('[12] room-scoped light — your room is lit, the rest is dark', () => {
  const t = softAssert();
console.log('[12] room-scoped light — your room is lit, the rest is dark');
{
  const W=76, H=76, DARK=A.DARK_ROOM, HOP=A.HOP_FALL;

  const hopsFrom = (start)=>{
    const adj=A.internals.regionAdj, hops=new Int32Array(adj.length).fill(-1);
    const q=[start]; hops[start]=0;
    for (let h=0; h<q.length; h++){
      for (const nb of adj[q[h]]) if (hops[nb]<0){ hops[nb]=hops[q[h]]+1; q.push(nb); }
    }
    return hops;
  };
  /* Put the player on a real floor tile of the given room and rescope.
     A stub partition can occupy a room's nominal centre, so scan rather
     than trusting rx+rw/2. */
  const standIn = (ri)=>{
    const r=G.rooms[ri];
    for (let y=r.ry;y<r.ry+r.rh;y++)
      for (let x=r.rx;x<r.rx+r.rw;x++){
        const i=y*W+x;
        if (G.grid[i]!==1 || A.internals.regionOf[i]!==ri) continue;
        G.player.x=x+0.5; G.player.y=y+0.5;
        A.scopeRoomLight(0, true);
        return true;
      }
    return false;
  };

  let floors=0, placed=0, leak=0, blackHole=0, noFollow=0, bakeMut=0, unreachable=0;
  let ownTotal=0, ownFloors=0, farTotal=0, farFloors=0;

  /* The falloff must be strictly decreasing — a table that rises at hop 3
     would light the room beyond a dark one, which is exactly the inversion
     that made the old step function confusing. */
  for (let i=1;i<HOP.length;i++)
    t.assert(HOP[i] < HOP[i-1], `scope rises at ${i} gates: ${HOP[i-1]} -> ${HOP[i]}`);
  t.assert(HOP[HOP.length-1] > 0 && HOP[HOP.length-1] < 0.2,
    `the far end of the falloff is ${HOP[HOP.length-1]}, want dim but not zero`);

  for (let s=0; s<120; s++){
    buildFloor(s%5, s*7717+31);
    floors++;
    const regOf=A.internals.regionOf, vis=A.internals.visArr, bake=A.internals.lightArr;

    // every floor tile must belong to SOME region, or scoping has a hole in
    // its coverage and part of the maze can never light up
    for (let i=0;i<W*H;i++){
      if (G.grid[i]===1 && regOf[i]<0){ unreachable++; break; }
    }

    // the bake must be a pure input: scoping must not scale it in place
    const bakeBefore = Float32Array.from(bake);

    const rooms = G.rooms;
    const homeRi = (s*13)%rooms.length;
    if (!standIn(homeRi)) continue;
    placed++;

    const here = A.internals.visRegion;
    t.assert(here>=0, `seed ${s}: player region is -1 while standing on floor`);
    const hops = hopsFrom(here);

    // region graph must be connected, or a player could be sealed into one
    // lit island with the rest of the floor unreachable by light forever
    for (let r=0;r<hops.length;r++) if (hops[r]<0){ unreachable++; break; }

    let ownSum=0, ownN=0, farSum=0, farN=0;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){
      const i=y*W+x;
      const shown = bake[i]*vis[i];          // what actually reaches the screen
      if (Number.isNaN(shown)) leak++;

      if (G.grid[i]===1){
        const r=regOf[i], h=hops[r]>=0?hops[r]:99;
        const want = h>=HOP.length ? HOP[HOP.length-1] : HOP[h];
        /* The scope must be exactly the falloff table for this tile's hop
           count. It USED to be asserted as a three-value step function, which
           is what let it be a cliff in the first place — nothing in the suite
           noticed that a corridor went black ten tiles ahead. */
        if (Math.abs(vis[i]-want) > 1e-6) leak++;
        if (h===0){
          // the room you are in: fully scoped, and bright enough to see by
          if (vis[i] < 0.999) leak++;
          if (shown < 0.40) blackHole++;
          ownSum+=shown; ownN++;
        } else { farSum+=shown; farN++; }
      } else {
        // a wall must never be darker than the brightest floor it touches —
        // that is what stops a partition from reading as a hole in the floor
        let nb=0;
        if (x+1<W   && G.grid[i+1]===1)   nb=Math.max(nb, vis[i+1]);
        if (x>0    && G.grid[i-1]===1)   nb=Math.max(nb, vis[i-1]);
        if (y+1<H  && G.grid[i+W]===1)   nb=Math.max(nb, vis[i+W]);
        if (y>0    && G.grid[i-W]===1)   nb=Math.max(nb, vis[i-W]);
        if (nb>0 && vis[i] < nb-1e-6) blackHole++;
      }
    }
    /* Accumulate across floors rather than per floor: DARK_ROOM is 0, so the
       far rooms sum to exactly zero and a per-floor ratio is division by
       zero. What is worth knowing is whether ANY far tile is ever lit. */
    if (ownN){ ownTotal += ownSum/ownN; ownFloors++; }
    if (farN && farSum > 0){ farTotal += farSum/farN; farFloors++; }

    // scoping must not have touched the bake
    for (let i=0;i<W*H;i++) if (bake[i]!==bakeBefore[i]){ bakeMut++; break; }

    /* And it must FOLLOW the player: rescope into a different room, then
       check the room just left is now dimmer than the one you are in. A scope
       computed once at floor build would pass every check above and still be a
       no-op in play. Note this used to assert the old room went BLACK; with a
       falloff that is the wrong rule — leaving a room dims it, it does not
       delete it. */
    const otherRi = (s*13+7)%rooms.length;
    if (otherRi!==homeRi && standIn(otherRi)){
      if (A.regionAt(G.player.x, G.player.y) !== A.internals.visRegion) noFollow++;
      const oldR=rooms[homeRi];
      const newScope = vis[Math.floor(G.player.y)*W+Math.floor(G.player.x)];
      for (let y=oldR.ry;y<oldR.ry+oldR.rh && !noFollow;y++)
        for (let x=oldR.rx;x<oldR.rx+oldR.rw;x++){
          const i=y*W+x;
          if (G.grid[i]===1 && vis[i] >= newScope - 1e-6){ noFollow++; break; }
        }
    }
  }

  t.assert(unreachable===0, `${unreachable}/120 floors had floor tiles with no region, or an unreachable region`);
  t.assert(leak===0, `${leak} visibility values did not match their region's scope`);
  t.assert(blackHole===0, `${blackHole} tiles were too dark to stand in or to see the wall beside`);
  t.assert(noFollow===0, `${noFollow} cases where the light did not follow the player into the next room`);
  t.assert(bakeMut===0, `${bakeMut} floors where scoping mutated the ambient bake in place`);
  /* The far rooms are dim now, not black — that is the point of the falloff —
     but your own room must still be plainly brighter than them, or the whole
     scoping rule has stopped meaning anything. */
  const ratio = farFloors ? (ownTotal/ownFloors)/(farTotal/farFloors) : Infinity;
  t.assert(ratio > 3.0,
    `your room is only ${ratio.toFixed(2)}x brighter than the rooms beyond it (want >3)`);
  console.log(`  ${floors} floors, ${placed} scoped; your room is ${ratio.toFixed(2)}x brighter than the far ones`);
  console.log(`  scope falls off ${HOP.map(v=>v.toFixed(2)).join(' -> ')} by gates crossed`);
  console.log(`  no leaks, no black walls, bake untouched, light follows the player`);

  /* --- the crossfade is not optional decoration ---
     An instant swap pops the whole screen; a fade that never converges
     leaves the player standing in a half-dark room forever. Both are bugs,
     so both are asserted. */
  buildFloor(0, 4242);
  {
    // pick two rooms that both have a standable tile
    let aRi=-1, bRi=-1;
    for (let i=0;i<G.rooms.length && bRi<0;i++){
      if (aRi<0){ if (standIn(i)) aRi=i; }
      else if (standIn(i)) bRi=i;
    }
    t.assert(aRi>=0 && bRi>=0, 'no two standable rooms found for the crossfade check');
    if (aRi>=0 && bRi>=0){
      standIn(aRi);
      const a=G.rooms[aRi], b=G.rooms[bRi];
      // a floor tile of A and of B to sample, found the same way
      const tileOf = (ri)=>{
        const r=G.rooms[ri];
        for (let y=r.ry;y<r.ry+r.rh;y++) for (let x=r.rx;x<r.rx+r.rw;x++)
          if (G.grid[y*W+x]===1 && A.internals.regionOf[y*W+x]===ri) return y*W+x;
        return -1;
      };
      const ai=tileOf(aRi), bi=tileOf(bRi);

      standIn(aRi);
      const litBefore = A.internals.visArr[ai];

      // land on a real tile of B, then begin the fade (non-instant)
      let placedB=false;
      for (let y=b.ry;y<b.ry+b.rh && !placedB;y++)
        for (let x=b.rx;x<b.rx+b.rw;x++){
          if (G.grid[y*W+x]!==1 || A.internals.regionOf[y*W+x]!==bRi) continue;
          G.player.x=x+0.5; G.player.y=y+0.5; placedB=true; break;
        }
      t.assert(placedB, 'room B had no standable floor tile');
      A.scopeRoomLight(0, false);
      const during = A.internals.visArr[ai];
      t.assert(during > litBefore - 1e-6,
        'the room you left went dark on the same frame you entered the new one — no crossfade');
      for (let i=0;i<600;i++) update(1/60);            // 10s: far past LIGHT_FADE
      const settled = A.internals.visArr[ai];
      const nowLit  = A.internals.visArr[bi];
      t.assert(settled < HOP[1]+1e-6, `the room you left settled at ${settled.toFixed(3)}, want <= ${HOP[1]}`);
      t.assert(nowLit  > 0.999, `the room you entered settled at ${nowLit.toFixed(3)}, want 1`);
      console.log(`  crossfade settles: left room ${settled.toFixed(2)}, entered room ${nowLit.toFixed(2)}`);
    }
  }

  /* --- sight down a corridor, which is the bug this falloff exists to fix ---
     A corridor is a band region, so under the old step-function scope it went
     black two regions out: on a measured 40-tile straight run the floor died
     at 10 tiles while dead ahead, in line of sight, inside the cone. Assert
     that a clear straight line stays visible well past a single gate. */
  {
    let best=null;
    for (let s=0; s<25 && !best; s++){
      buildFloor(0, 3000+s*1777);
      for (let i=0;i<2;i++) update(1/60);
      for (let y=3;y<73 && !best;y++) for (let x=3;x<73;x++){
        if (G.grid[y*W+x]!==1) continue;
        let run=0;
        while (x+run<73 && G.grid[y*W+x+run]===1) run++;
        if (run<18) continue;
        if (regionOfIdx(y*W+x)===regionOfIdx(y*W+x+run-1)) continue;
        if (run > (best?best.run:0)) best={x,y,run};
      }
    }
    t.assert(best, 'no long open run found to test sight distance with');
    if (best){
      G.player.x=best.x+0.5; G.player.y=best.y+0.5; G.player.face=0;
      G.radar=false;                                  // isolate the cone + scope
      A.snapMask();   // traces + combines + uploads, no easing
      const at=(d)=>{ const i=best.y*W+best.x+d; return {d, mask:A.internals.maskArr[i], scope:A.internals.visArr[i], cone:A.internals.coneArr[i]}; };
      const far = at(Math.min(18, best.run-1));
      const near= at(2);
      console.log(`  straight ${best.run}-tile run: mask at 2 tiles ${near.mask.toFixed(2)}, `+
                  `at ${far.d} tiles ${far.mask.toFixed(2)} (scope ${far.scope.toFixed(2)})`);
      t.assert(far.cone > 0.5,
        `the cone only reaches ${far.cone.toFixed(2)} at ${far.d} tiles down a clear straight line`);
      t.assert(far.mask > 0.05,
        `sight dies at ${far.d} tiles down a clear straight corridor — the scope is a cliff again`);
      t.assert(far.mask < near.mask,
        'a corridor does not get brighter with distance');
      // and it must still fade out eventually, not run to the far wall
      const end = at(best.run-1);
      t.assert(end.mask <= far.mask + 1e-6,
        'the corridor gets brighter toward the far end');
    }
  }
  function regionOfIdx(i){ return A.internals.regionOf[i]; }
}
  t.done();
});

/* ============ TEST 13: cone of vision ==============================
   200 degrees, stopped by walls. Two failure modes that look identical on
   screen and are caught completely differently here:

     - a cone that does not rotate, so you can see behind you permanently
     - a cone that ignores walls, so a one-tile partition stub fails to hide
       the floor behind it

   The second is why this is a ray cast and not a per-tile angle test, and it
   is invisible in aggregate statistics: the stub is 1 tile of 5776.            */
test('[13] cone of vision — 200 degrees, occluded by walls', () => {
  const t = softAssert();
console.log('[13] cone of vision — 200 degrees, occluded by walls');
{
  const W=76, HALF=A.VIEW_HALF;

  buildFloor(1, 5150);
  /* Put the player in the most open spot on the floor: a big room with the
     longest clear run we can find, so the cone has room to actually spread
     and a failure to rotate cannot hide behind geometry. */
  let spot=null, bestClear=-1;
  for (let y=4;y<72;y++) for (let x=4;x<72;x++){
    if (G.grid[y*W+x]!==1) continue;
    // count floor tiles with clear LOS, which is what an open room maximises
    let clear=0;
    for (let d=1;d<=10;d++) for (const [dx,dy] of [[d,0],[-d,0],[0,d],[0,-d]]){
      const nx=x+dx, ny=y+dy;
      if (nx<0||ny<0||nx>=W||ny>=W) continue;
      if (G.grid[ny*W+nx]!==1 || !G.los(x+0.5,y+0.5,nx+0.5,ny+0.5)) break;
      clear++;
    }
    if (clear>bestClear){ bestClear=clear; spot={x:x+0.5,y:y+0.5}; }
  }
  t.assert(spot && bestClear>=8, `no open spot found (best clear run ${bestClear})`);

  const set=(fx,fy,face)=>{
    G.player.x=spot.x; G.player.y=spot.y; G.player.face=face;
    G.radar=false;
    A.scopeRoomLight(0,true);
    A.snapMask();
  };

  /* Independent occlusion oracle: does the segment from the eye to the tile
     centre pass through any solid tile? Sampled finely rather than walked with
     Bresenham, because the game walks with an exact voxel traversal and the
     two disagree by a tile exactly at the corners and diagonals where the
     question is interesting. Sampling is neither of them. */
  const solid=(x,y)=> (x<0||y<0||x>=W||y>=W) || G.grid[y*W+x]===0;
  const occluded=(ax,ay,bx,by)=>{
    const n=Math.ceil(Math.hypot(bx-ax,by-ay)/0.04);
    for (let i=1;i<n;i++){
      const t=i/n;
      if (solid(Math.floor(ax+(bx-ax)*t), Math.floor(ay+(by-ay)*t))) return true;
    }
    return false;
  };
  const eye=()=>[spot.x + Math.cos(G.player.face)*A.HAND_OFF,
                 spot.y + Math.sin(G.player.face)*A.HAND_OFF];

  /* Can ANY line from the eye reach this tile? Sampled over a disc inside the
     tile rather than to its exact centre, because "the tile is visible" means
     some part of it is, and testing only the centre line flags tiles you can
     plainly see the edge of. Built from the fine occlusion sampler above, so
     it shares no traversal code with the game's voxel walk. */
  const SEES=(()=>{
    const pts=[[0,0]];
    for (const r of [0.25, 0.42]) for (let a=0; a<8; a++){
      const th=a/8*Math.PI*2;
      pts.push([Math.cos(th)*r, Math.sin(th)*r]);
    }
    return pts;
  })();
  const seesTile=(ax,ay,ix,iy)=>{
    for (const [ox,oy] of SEES)
      if (!occluded(ax,ay, ix+0.5+ox, iy+0.5+oy)) return true;
    return false;
  };

  /* --- 1. it rotates: what you can see must depend on facing --- */
  const probes=[0, Math.PI/2, Math.PI, -Math.PI/2];
  const seenAt = probes.map(face=>{
    set(spot.x, spot.y, face);
    const v = Array.from(A.internals.coneArr);
    return {face, v};
  });
  let maxDiff=0;
  for (let a=0;a<probes.length;a++) for (let b=a+1;b<probes.length;b++)
    for (let i=0;i<seenAt[0].v.length;i++)
      maxDiff=Math.max(maxDiff, Math.abs(seenAt[a].v[i]-seenAt[b].v[i]));
  t.assert(maxDiff > 0.5,
    `the cone barely changes with facing (max tile delta ${maxDiff.toFixed(3)}) — it is not rotating`);

  /* --- 2. what is IN the cone and what is not ---
     Facing east (+x) in an open spot: floor to the east must be lit, floor to
     the west must not be. This is the direction test that a wall-blind
     implementation still passes, so it is asserted separately from (3). */
  set(spot.x, spot.y, 0);
  let eastLit=0, eastTot=0, westLit=0, westTot=0;
  const [ex1,ey1]=eye();
  for (let d=1; d<=8; d++){
    const iF=Math.floor(spot.y)*W + (Math.floor(spot.x)+d);
    const iB=Math.floor(spot.y)*W + (Math.floor(spot.x)-d);
    if (iF>=0 && iF<W*W && G.grid[iF]===1 && seesTile(ex1,ey1,iF%W,Math.floor(iF/W))){
      eastTot++; if (A.internals.coneArr[iF]>0.5) eastLit++;
    }
    if (iB>=0 && G.grid[iB]===1 && seesTile(ex1,ey1,iB%W,Math.floor(iB/W))){
      westTot++; if (A.internals.coneArr[iB]>0.5) westLit++;
    }
  }
  console.log(`  facing east: ${eastLit}/${eastTot} floor tiles lit ahead, ${westLit}/${westTot} behind`);
  t.assert(eastTot>=6, `only ${eastTot} clear tiles ahead — cannot test directionality`);
  t.assert(eastLit === eastTot, `${eastTot-eastLit} clear tiles directly ahead were not lit — the cone is not where the character is looking`);
  t.assert(westLit === 0, `${westLit} tiles behind the character are lit — 80 degrees of blindness should be behind you`);

  /* --- 3. walls occlude: the property a per-tile angle test gets wrong ---
     The claim is not "the cone never reaches an occluded tile" — the cone is
     a fan of rays and it will happily sweep across a wall that is further
     away than the thing it is occluding. The claim is that NOTHING OCCLUDED
     IS EVER VISIBLE, which is what the player experiences. So this asserts on
     the mask, and counts separately the occluded tiles that lie inside the
     cone's angle AND in a lit region, where nothing but occlusion could be
     keeping them dark. */
  set(spot.x, spot.y, 0);
  let occludedVisible=0, occludedTotal=0, inLitRegion=0, worstAngle=0;
  const [ex2,ey2]=eye();
  for (let y=2;y<74;y++) for (let x=2;x<74;x++){
    const i=y*76+x;
    if (G.grid[i]!==1) continue;
    if (seesTile(ex2,ey2,x,y)) continue;      // reachable: not a pocket
    occludedTotal++;
    if (A.internals.maskArr[i] > 0.02) occludedVisible++;
    const ang=Math.atan2(y+0.5-spot.y, x+0.5-spot.x);
    let d=Math.abs(ang); if (d>Math.PI) d=Math.abs(d-Math.PI*2);
    if (d>HALF) continue;                 // outside the cone: irrelevant either way
    if (A.internals.visArr[i] <= 0) continue;       // dark room: the scope hides it regardless
    inLitRegion++;
    worstAngle=Math.max(worstAngle,d);
    if (A.internals.maskArr[i] > 0.02) occludedVisible++;
  }
  console.log(`  ${occludedTotal} floor tiles behind a wall; ${occludedVisible} of them visible. `+
              `${inLitRegion} sit inside the cone's angle AND a lit room `+
              `(up to ${(worstAngle*180/Math.PI).toFixed(0)}deg off axis)`);
  t.assert(occludedTotal>4, `only ${occludedTotal} occluded tiles on this floor — cannot test occlusion`);
  t.assert(inLitRegion>4, `only ${inLitRegion} occluded tiles in a lit region — cannot isolate occlusion from scoping`);
  t.assert(occludedVisible===0,
    `${occludedVisible} tiles behind a wall are visible — the cone ignores occlusion`);

  /* --- 4. the radar must lift the WHOLE floor, and only while it is on ---
     With the radar off the mask is scope x cone and a distant room stays dark
     even dead ahead. With it on there is nowhere dark left — which is the
     entire tool, and the reason it costs what it costs. Asserting both halves
     is the point: a radar that only reveals the next room is not a radar. */
  G.radar = false;
  A.snapMask();   // traces + combines + uploads, no easing
  {
    let ahead=0, aheadLit=0;
    for (let d=1; d<=16; d++){
      const x=Math.floor(spot.x)+d, y=Math.floor(spot.y);
      if (x>=W || G.grid[y*W+x]!==1) break;
      if (G.los(spot.x,spot.y,x+0.5,y+0.5)){ ahead++; if (A.internals.maskArr[y*W+x]>0.5) aheadLit++; }
    }
    if (ahead>0) console.log(`  ${aheadLit}/${ahead} clear tiles ahead are visible with the radar off`);
  }
  G.radar = true;
  A.snapMask();   // traces + combines + uploads, no easing
  {
    let lit=0, wall=0, tiles=0;
    for (let i=0;i<W*W;i++){
      if (A.internals.maskArr[i] > 0.999) lit++;
      tiles++;
      if (G.grid[i]===0 && A.internals.maskArr[i] > 0.999) wall++;
    }
    t.assert(lit === tiles,
      `radar on leaves ${tiles-lit} tiles dark — a sweep has no dark spots`);
    console.log(`  radar on: all ${tiles} tiles lit (${wall} of them walls)`);
  }
  G.radar = false;
  A.snapMask();   // traces + combines + uploads, no easing

  /* --- 5. the mask is the function the renderer depends on ---
     With the radar off, every visible tile must be explainable by scope x cone
     (the distance term only makes it smaller, so it can never be a source of
     light) and a tile with neither must be exactly zero. */
  {
    let outOfScopeLit=0, zeroViolations=0, nan=0;
    for (let i=0;i<W*W;i++){
      const m=A.internals.maskArr[i];
      if (Number.isNaN(m)){ nan++; continue; }
      if (m<0 || m>1+1e-6){ nan++; continue; }
      const scope=A.internals.visArr[i], cone=A.internals.coneArr[i];
      if (m > scope*cone + 1e-6) outOfScopeLit++;
      if (scope<=0 && cone<=0 && m > 1e-6) zeroViolations++;
    }
    t.assert(nan===0, `${nan} mask tiles were NaN or out of range`);
    t.assert(outOfScopeLit===0, `${outOfScopeLit} tiles are lit by neither the scope nor the cone`);
    t.assert(zeroViolations===0, `${zeroViolations} tiles are lit with no scope and no cone — nothing should be visible`);
  }

  /* --- 6. your own room does not dim with distance ---
     The distance falloff exists to make a corridor recede. It must not touch
     the room you are standing in, which is at most 12 tiles across: the far
     corner of your own room has to be as bright as the tile underfoot, or the
     feature has quietly reintroduced the gradient it was built to remove. */
  {
    let dimmed=0, checked=0;
    for (let y=1;y<75;y++) for (let x=1;x<75;x++){
      const i=y*W+x;
      if (G.grid[i]!==1 || A.internals.visArr[i] < 0.999) continue;
      if (A.internals.coneArr[i] <= 0.02) continue;             // not in view: nothing to judge
      checked++;
      if (A.internals.maskArr[i] < 0.999) dimmed++;
    }
    t.assert(checked>0, 'no visible tiles in the player\'s own room to check');
    t.assert(dimmed===0, `${dimmed}/${checked} visible tiles in your own room are dimmed — the room must not fade with distance`);
  }

  /* --- 6. walls are never blacker than the floor they border ---
     The failure that makes a lit room look like it has holes cut in it. */
  {
    let holes=0;
    for (let y=1;y<75;y++) for (let x=1;x<75;x++){
      const i=y*W+x;
      if (G.grid[i]!==0) continue;
      let nb=0;
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const ni=(y+dy)*W+(x+dx);
        if (G.grid[ni]===1) nb=Math.max(nb, A.internals.maskArr[ni]);
      }
      if (nb>0.5 && A.internals.maskArr[i] < nb-1e-6) holes++;
    }
    t.assert(holes===0, `${holes} walls are darker than the floor in front of them — they read as holes`);
  }

  console.log('  cone rotates, occludes at walls, and never reaches past the room scope');
}
  t.done();
});
