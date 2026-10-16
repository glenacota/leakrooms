/* ============================================================
   test.js — headless regression suite for game.js
   Run:  node test.js        (exit 0 = pass)

   game.js is DOM/canvas-coupled, so this stubs just enough of both to load
   the real module and drive its real logic: maze generation, the ambient
   light bake, line of sight, the noise/stealth layer, entity AI, and the
   descend flow. Nothing here is reimplemented, so a bug in the game cannot
   hide behind a matching bug in the test.

   Two collision oracles are written from scratch (inWall, exact
   circle-vs-tile-AABB) rather than calling the game's own blocked(), so the
   two have to agree independently.
   ============================================================ */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fakeAudioContext } from './tests/helpers/stubs.js';
import { softAssert } from './tests/helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from './tests/helpers/src-text.js';
import { loadGame } from './tests/helpers/harness.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const { A, G, els, calls, store, press } = await loadGame();

/* seeded RNG for deterministic fuzzing */

const moveEnt= A.moveEnt;
const blocked= A.blocked;
const keys   = A.keys;
const emitNoise= A.emitNoise;
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;

/* ---- per-test timing -------------------------------------------------
   There was no timing output at all, which is why the slowest thing in
   this suite went unnoticed for as long as it did: test 4 was 87% of the
   wall clock and nothing said so. Every banner now carries the cumulative
   time since the suite started, and the five slowest sections are
   summarised at the end. Cheap, and it makes the next regression visible
   without reaching for a profiler. */
const T0 = Date.now();
const _log = console.log.bind(console);
const _banner = /^\[\d/;
let _openBanner = null;  // {name, start} while a test is running
const timings = [];
console.log = (...a)=>{
  const now = Date.now();
  const isBanner = _banner.test(String(a[0]));
  if (isBanner){
    if (_openBanner) timings.push({name:_openBanner.name, ms:now-_openBanner.start});
    /* Cumulative, not per-line: the number that matters when a suite gets
       slow is "how long has it been", not "how long did this one print
       take". The per-section split is in the summary at the end. */
    _openBanner = {name:String(a[0]), start:now};
    _log(`[${((now-T0)/1000).toFixed(1)}s]`, ...a);
  } else {
    _log(...a);
  }
};
const reportTimings = ()=>{
  const now = Date.now();
  if (_openBanner) timings.push({name:_openBanner.name, ms:now-_openBanner.start});
  timings.sort((x,y)=>y.ms-x.ms);
  const total = now-T0;
  /* Note the variance: the suite is not seeded, so identical runs land
     anywhere in roughly 75-115s. A single run's slowest-section list is
     indicative, not precise. */
  console.log(`\nslowest sections (of ${(total/1000).toFixed(1)}s total):`);
  for (const t of timings.slice(0,5))
    console.log(`  ${(t.ms/1000).toFixed(1).padStart(7)}s  ${((t.ms/total)*100).toFixed(0).padStart(3)}%  ${t.name}`);
};

/* ============ TEST 1: maze integrity across 400 seeds ============ */
const _sa = softAssert();
let fail = 0;
const assert = (c,m)=>{ if(!c) fail++; _sa.assert(c,m); };

/* ---- HEADLESS GATING --------------------------------------------------
   packMask + packWet write two 5776-tile images per frame. traceViewCone
   fires 240 rays and smoothMask eases another 5776 floats. Measured at 48%
   of this suite's CPU. Tests that assert on neither are switched off here
   and switched back on by the tests that read pixels or maskArr — tests 12
   through 19 all need at least the vision half, and test 17 reads the flood
   image directly.

   This is a change to what the SUITE pays for, not to what the game
   computes: every assertion below still runs against the real arrays, and
   the game itself never sets either flag. */
A.setHeadless(false, false);


/* ============ TEST 4: end-to-end playthroughs =========================
   A bot drives real key state through the real update(). It walks to the
   nearest open riser, holds still to seal it, then walks back to the door it
   came in through — which is the entire level. This proves the game is
   FINISHABLE, and that three minutes is enough of a budget to do five levels of
   it in. Note it is a weak player: it ignores the Lifeform until it is 9 tiles
   away, so its death rate is reported but is NOT a difficulty signal.        */
console.log('[4] end-to-end — bot drives REAL keys through update()');
{
  const W=76,H=76, IDX=(x,y)=>y*W+x;

  function distField(gx,gy){
    const dist=new Int32Array(W*H).fill(-1);
    const g0=IDX(gx|0,gy|0);
    if(gx<0||gy<0||gx>=W||gy>=H||G.grid[g0]!==1) return null;
    const q=[g0]; dist[g0]=0;
    for(let h=0;h<q.length;h++){
      const c=q[h],cx=c%W,cy=(c/W)|0;
      const nb=[[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
      for(const [nx,ny] of nb){
        if(nx<0||ny<0||nx>=W||ny>=H) continue;
        const ni=IDX(nx,ny);
        if(G.grid[ni]!==1||dist[ni]>=0) continue;
        dist[ni]=dist[c]+1; q.push(ni);
      }
    }
    return dist;
  }
  // an exit is a WALL tile, so goal at a floor tile that touches it
  function exitGoal(e){
    const cand=[[e.x+1,e.y],[e.x-1,e.y],[e.x,e.y+1],[e.x,e.y-1]]
      .filter(([x,y])=>x>=0&&y>=0&&x<W&&y<H&&G.grid[IDX(x,y)]===1);
    if(!cand.length) return null;
    const px=G.player.x, py=G.player.y;
    let b=cand[0], bd=Infinity;
    for(const [cx,cy] of cand){
      const d=Math.abs(cx-px)+Math.abs(cy-py);
      if(d<bd){ bd=d; b=[cx,cy]; }
    }
    return {x:b[0], y:b[1], tile:IDX(b[0],b[1])};
  }
  const distTo=(f,tile)=> f ? (f[tile]>=0?f[tile]:9999) : 9999;

  // BFS path from a tile to a tile, inclusive of the start
  function bfsPath(sx,sy,gx,gy){
    if(sx===gx && sy===gy) return [];
    const prev=new Int32Array(W*H).fill(-1);
    const st=IDX(sx,sy), goal=IDX(gx,gy);
    if(G.grid[st]!==1||G.grid[goal]!==1) return null;
    prev[st]=st; const q=[st];
    for(let h=0;h<q.length;h++){
      const c=q[h];
      if(c===goal) break;
      const cx=c%W, cy=(c/W)|0;
      for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if(nx<0||ny<0||nx>=W||ny>=H) continue;
        const ni=IDX(nx,ny);
        if(G.grid[ni]!==1||prev[ni]>=0) continue;
        prev[ni]=c; q.push(ni);
      }
    }
    if(prev[goal]<0) return null;
    const out=[]; let c=goal;
    while(c!==st){ out.push([c%W,(c/W)|0]); c=prev[c]; }
    out.push([sx,sy]);
    return out.reverse();
  }

  function play(seed, withEntity, maxMinutes){
    const SF=0;
    const sd = seed;
    // mirror what the start button does, so nextFloor() keeps deriving floors
    // from THIS seed — otherwise every seed plays the identical floor 1..4
    A.RUN_SEED = sd;
    buildFloor(SF, sd);
    A.STATE='play';
    A.lives=3; A.floorIdx=SF; A.runTime=0;
    let t=0, field=null, gk='', deaths=0, lowestBatt=100, minMargin=1e9, why='?';
    let path=null, wi=0, pathFromX=-99, pathFromY=-99, goalId=-1;
    let escapes=0, swapped=false, hasMovedLastFrame=false, riserGoal=null, lastRiserKey='';
    let fromHere=null, fromX0=-99, fromY0=-99;

    while(A.floorIdx<5 && t<60*maxMinutes){
      if(!withEntity && G.agents.length) G.agents.length=0;

      const live=G.batteries.filter(b=>!b.taken);
      const px=G.player.x, py=G.player.y, cur=IDX(Math.floor(px),Math.floor(py));

      /* --- THE LEVEL, IN ORDER.
         Seal every riser, then get back to the door. There is no third thing to
         find any more, so the bot's whole objective is a work list and a
         journey home, and the journey home only starts when the list is empty.

         The repair is modelled exactly: no keys, no radar, no movement, for as
         many frames as the bar takes. Releasing the keys IS the repair input —
         there is no button — so a hold is five seconds of doing nothing, which
         the loop has to actually run. */
      const open = G.leaks.filter(L=>!L.fixed);
      if (open.length){
        /* Nearest open riser by WALKING distance, from one BFS out from the
           player's own tile. Straight-line distance is the trap here: on a BSP
           floor the pipe nearest as the crow flies is regularly the furthest
           one to walk to, so a Euclidean bot spends most of its three minutes
           crossing the building twice and reports that the clock is impossible
           when what it actually measured is its own routing. One field per leg,
           rebuilt when the player has left the neighbourhood it describes. */
        if (!fromHere || Math.hypot(px-fromX0, py-fromY0) > 4){
          fromHere = distField(Math.floor(px), Math.floor(py));
          fromX0 = px; fromY0 = py;
        }
        let best=null, bd=Infinity;
        for(const L of open){
          const d = distTo(fromHere, IDX(L.sx, L.sy));
          if (d<bd){ bd=d; best=L; }
        }
        /* Ask the GAME's own predicate whether we are in reach, rather than a
           tighter radius of the test's own. A bot that starts holding at 0.34
           while the game allows REPAIR_REACH is testing a stricter game than
           the one that ships. */
        if (A.leakReach(px, py)){
          keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
          A.updateReal(1/60); t+=1/60;
          if (A.STATE!=='play'){ deaths++;
            const lv=A.lives;
            if (lv<=0) break;
            A.RUN_SEED = sd;
            buildFloor(A.floorIdx, sd);
            A.STATE='play'; gk=''; path=null; goalId=-1;
          }
          continue;
        }
        /* The path is NOT nulled on a goal change. It was, and that single line
           made this the slowest thing in the suite by an order of magnitude:
           the rebuild condition is `!path || off-course`, so a null every frame
           rebuilt a 5776-entry BFS on every frame of what is the longest walk in
           the game. Invalidating when the player leaves the corridor they were
           given is enough. */
        const rk = best.sx+','+best.sy;
        if (rk !== lastRiserKey){ lastRiserKey = rk; goalId=-1; }
        riserGoal={x:best.sx, y:best.sy};
      } else {
        riserGoal=null; lastRiserKey='';
      }

      /* --- the goal: riser, then recharge, then the door --- */
      const doorGoal = exitGoal(G.exitTiles[0]);
      let goal=null, kind=null;
      if (riserGoal){ goal=riserGoal; kind='riser'; }
      const needCharge = !goal && G.batt<30 && live.length;
      if(needCharge){
        let bb=null,bbd=Infinity;
        for(const b of live){
          const tx=Math.floor(b.x), ty=Math.floor(b.y);
          if(blocked(b.x,b.y,0.30)) continue;
          const d=Math.abs(tx-px)+Math.abs(ty-py);
          if(d<bbd){ bbd=d; bb={x:tx,y:ty}; }
        }
        if(bb){ goal=bb; kind='batt'; }
      }
      if(!goal && doorGoal){ goal=doorGoal; kind='door'; }
      if(!goal){ why='no goal tile'; break; }

      const key=`${A.floorIdx},${kind},${goal.x},${goal.y}`;
      if(key!==gk){ gk=key; field=distField(goal.x,goal.y); }
      if(!field) field=distField(goal.x,goal.y);
      if(!field){ why='no field'; break; }

      /* --- no sweeping.
         The radar used to be an exit-finder and there is nothing left in the
         world that needs finding: the door is where you came in and the pipes
         announce themselves in water. So a sweep is pure waste against a
         three-minute budget, and the bot travelling dark is exactly the play the
         clock is asking for. It still has to SURVIVE the budget, so a dead radar
         must not be a soft-lock — hence the battery-margin assertion below. */
      G.radar = false;

      /* --- steer by FOLLOWING AN EXPLICIT PATH ---
         Descending a distance field with single-axis steps gets trapped in
         local minima (it walks into a pocket where every neighbour is a
         "hill" and shuffles forever). Following a real path with waypoints
         cannot get stuck. Rebuilt whenever the player's tile changes. */
      keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
      const cx=Math.floor(px), cy=Math.floor(py);
      const here=field[cur];

      let ta=null, td=99;
      for(const a of G.agents){
        if(a.state==='DORMANT'||a.rise<=0.5) continue;
        const d=Math.hypot(a.x-px,a.y-py);
        if(d<td){ td=d; ta=a; }
      }
      if(ta && td<9) keys.shift=true;

      let wp=null;
      if(here>0){
        /* Rebuild only when genuinely off-course. Rebuilding on every tile
           change thrashes: standing at exactly x=9.0 makes floor(x) flicker
           between 8 and 9, so the path flipped every few frames and the bot
           paced on the spot forever. */
        const stale = !path || wi>=path.length ||
                      Math.hypot(px-pathFromX, py-pathFromY) > 2.5 ||
                      IDX(goal.x,goal.y)!==goalId;
        if(stale){
          pathFromX=px; pathFromY=py; goalId=IDX(goal.x,goal.y);
          path=bfsPath(cx,cy,goal.x,goal.y); wi=0;
        }
        if(path && path.length){
          while(wi<path.length-1 &&
                Math.hypot(path[wi][0]+0.5-px, path[wi][1]+0.5-py) < 0.45) wi++;
          wp=path[wi];
        }
      }

      let tgt=null;
      if(ta && td<9){
        // FLEE: step away from the hunter
        const nb=[[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
        let fa=td;
        for(const [nx,ny] of nb){
          if(field[IDX(nx,ny)]<0) continue;
          const away=Math.hypot(nx-ta.x,ny-ta.y);
          const ux=nx-cx, uy=ny-cy;
          if(away>fa && !blocked(px+ux*0.15, py+uy*0.15, 0.33)){ fa=away; tgt=[nx+0.5,ny+0.5]; }
        }
      }
      if(!tgt && wp) tgt=[wp[0]+0.5, wp[1]+0.5];
      if(!tgt && here===0) tgt=[goal.x+0.5, goal.y+0.5];

      if(tgt){
        const dx=tgt[0]-px, dy=tgt[1]-py;
        // Axis preference FLIPS when the previous press produced no movement.
        // Committed to one axis, the bot jams at wall corners that a human
        // trivially walks around by sliding the other way.
        const X=[dx>0?'d':'a', dx>0?1:-1, 0];
        const Y=[dy>0?'s':'w', 0, dy>0?1:-1];
        const wantFirst = Math.abs(dx)>Math.abs(dy);
        const opts = (wantFirst!==swapped) ? [X,Y] : [Y,X];
        if(!hasMovedLastFrame) swapped=!swapped;
        hasMovedLastFrame=false;
        let moved=false;
        for(const [k2,ux,uy] of opts){
          if(Math.abs(ux*dx)+Math.abs(uy*dy) < 0.06) continue;
          if(!blocked(px+ux*0.15, py+uy*0.15, 0.33)){ keys[k2]=true; moved=true; break; }
        }
        if(!moved){
          for(const [k2,ux,uy] of opts){
            if(Math.abs(ux*dx)+Math.abs(uy*dy) < 0.06) continue;
            if(!blocked(px+ux*0.2, py+uy*0.2, 0.30)){ keys[k2]=true; break; }
          }
        }
      } else if(here<0){
        path=null; goalId=-1;
      }

      const bx0=G.player.x, by0=G.player.y;
      A.updateReal(1/60); t+=1/60;
      if(Math.abs(G.player.x-bx0)+Math.abs(G.player.y-by0) > 1e-6) hasMovedLastFrame=true;
      lowestBatt=Math.min(lowestBatt,G.batt);
      /* Clock headroom, not battery headroom: the number that can end a level
         is now seconds left, and the tightest moment is the last frame of the
         walk home with the work already done. */
      minMargin=Math.min(minMargin, G.clock);

      if(A.STATE!=='play'){
        deaths++;
        const lv=A.lives;
        if(lv<=0) break;
        A.RUN_SEED = sd;
        buildFloor(A.floorIdx, sd);
        A.STATE='play'; gk=''; path=null; goalId=-1;
      }
    }
    keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
    if(A.floorIdx>=5) why='completed';
    else if(A.lives<=0) why='lost all 3 lives on level '+A.floorIdx;
    else why='timeout on level '+A.floorIdx;
    return { depth:A.floorIdx, t, deaths, lowestBatt, minMargin, why, escapes };
  }

  // --- 4a: level-design feasibility (no monster) ---
  let feas=0, ft=[], worstMargin=1e9, worstBatt=100, escA=0;
  globalThis.TRACE=false;
  for(let s=0;s<6;s++){
    const r=play(s*5077+5, false, 5);
    if(r.depth>=5){ feas++; ft.push(r.t); }
    if(process.env.V) console.log(`     seed ${s}: depth ${r.depth}/5 time ${r.t.toFixed(0)}s why=${r.why}`);
    worstMargin=Math.min(worstMargin,r.minMargin); escA+=r.escapes;
    worstBatt=Math.min(worstBatt,r.lowestBatt);
  }
  console.log(`[4a] feasibility — ${feas}/6 runs cleared all 5 levels with no monster`);
  /* The bot's own deadline is deliberately far longer than the game's. What is
     being measured here is the game's clock: if a bot that walks in straight
     lines, ignores the lifeforms entirely and never sweeps cannot get five
     levels done inside three minutes a level, then neither can a player, and
     the clock is the thing that is wrong rather than the bot. */
  if(ft.length) console.log(`     avg ${(ft.reduce((a,b)=>a+b,0)/ft.length/60).toFixed(1)} min per 5-level run`);
  console.log(`     tightest clock headroom: ${worstMargin.toFixed(0)}s (negative = ran out)`);
  console.log(`     lowest battery observed: ${worstBatt.toFixed(0)}   bot escapes: ${escA}`);

  assert(worstMargin>0, 'clock headroom goes negative — a careful player would run out of time');

  // --- 4b: full game with the monster ---
  let wins=0, rt=[], dsum=0, reach=0, escSum=0;
  for(let s=0;s<6;s++){
    const r=play(s*3319+11, true, 5);
    if(r.depth>=5){ wins++; rt.push(r.t); }
    dsum+=r.deaths; reach=Math.max(reach,r.depth); escSum+=r.escapes;
  }
  console.log(`[4b] with monster — ${wins}/6 runs cleared all 5 levels, deepest ${reach}/5, deaths ${dsum}, bot escapes ${escSum}`);
  if(rt.length) console.log(`     avg completed run ${(rt.reduce((a,b)=>a+b,0)/rt.length/60).toFixed(1)} min`);
  // Informational only. The bot ignores the entity until it is 9 tiles away and
  // flees into whatever dead end is nearest, so its death rate is NOT a valid
  // difficulty signal — only a human playtest can tune that.
  console.log(`     (informational: bot deaths are not a difficulty signal)`);
}

/* ============ TEST 5: render does not throw ============ */
console.log('[5] render — 400 frames of full draw');
{
  buildFloor(2, 4242);
  let t=Date.now(), err=null;
  try {
    for(let i=0;i<400;i++){ render(t+=16); update(0.016); }
  } catch(e){ err=e; }
  assert(!err, 'render threw: '+(err&&err.message));
  console.log(err? '  FAIL' : '  ok — no exceptions');
}

/* ============ TEST 7: camera mapping ==============================
   The first playable build panned the world the wrong way and threw the
   player off-screen: the camera offset mixed a pre-scaled value with a
   device-space one and carried SCALE twice. Lock the mapping down.        */
console.log('[7] camera mapping — player centred, world not inverted');
{
  buildFloor(2, 31337);
  G.player.x = 51.25; G.player.y = 18.6; G.player.face = 0;
  for (let i=1;i<=90;i++) render(1000 + i*16.7);   // let the camera settle

  calls.list.length = 0;
  render(1000 + 91*16.7);

  let SCALE=1, tx=null, ty=null, lightDraw=null, wetDraw=null;
  for (const c of calls.list){
    if (c[0]==='setTransform' && SCALE===1 && c[1]!==1) SCALE = c[1];   // FIRST one is the camera
    if (c[0]==='translate' && tx===null){ tx = c[1]; ty = c[2]; }
    if (c[0]==='drawImage' && c[1]===A.internals.lightCv) lightDraw = c;
    if (c[0]==='drawImage' && c[1]===A.internals.wetCv) wetDraw = c;
  }
  assert(SCALE>0, 'no setTransform captured');
  assert(tx!==null, 'no translate captured');
  const TW = A.TILE;
  const w2s = (wx,wy)=> [ SCALE*(wx*TW + tx), SCALE*(wy*TW + ty) ];

  const [pxDev, pyDev] = w2s(G.player.x, G.player.y);
  const CW = A.cvs.width, CH = A.cvs.height;
  const tol = TW*SCALE*0.6;
  assert(Math.abs(pxDev-CW/2) < tol,
    `player x is ${(pxDev-CW/2).toFixed(0)}px from centre (tol ${tol.toFixed(0)})`);
  assert(Math.abs(pyDev-CH/2) < tol,
    `player y is ${(pyDev-CH/2).toFixed(0)}px from centre`);

  // orientation: 5 tiles to the LEFT must be LEFT of centre on screen
  const [lxDev] = w2s(G.player.x-5, G.player.y);
  const [rDev ] = w2s(G.player.x+5, G.player.y);
  const [,uDev] = w2s(G.player.x, G.player.y-5);
  const [,dDev] = w2s(G.player.x, G.player.y+5);
  assert(lxDev < pxDev, `X inverted: 5 tiles left landed ${(lxDev-pxDev).toFixed(0)}px from centre`);
  assert(rDev > pxDev, 'X inverted (right)');
  assert(uDev < pyDev, `Y inverted (up): up=${uDev} vs centre=${pyDev}`);
  assert(dDev > pyDev, 'Y inverted (down)');

  // scale must be applied exactly once
  const span = rDev - lxDev;
  assert(Math.abs(span - 10*TW*SCALE) < 0.5,
    `10 tiles spans ${span.toFixed(0)}px, expected ${(10*TW*SCALE).toFixed(0)}px — SCALE applied twice?`);

  /* The light bake must share the origin of the geometry.
     This now identifies the lightmap BY IMAGE rather than as "the first
     drawImage in the frame". The flood pass draws its own image inside the
     world transform first, so the ordinal was quietly measuring the wrong
     thing and reporting a spurious failure — the lightmap was aligned the
     whole time. An assertion that depends on draw order is a landmine for
     whoever adds the next image. */
  assert(lightDraw, 'lightmap drawImage not captured');
  // drawImage args are [img, x, y, ...] so the origin is at index 2/3
  assert(Math.abs(lightDraw[2] - tx*SCALE) < 0.01 && Math.abs(lightDraw[3] - ty*SCALE) < 0.01,
    `lightmap origin (${lightDraw[2]?.toFixed(1)},${lightDraw[3]?.toFixed(1)}) != world origin `+
    `(${(tx*SCALE).toFixed(1)},${(ty*SCALE).toFixed(1)}) — lighting will be offset`);

  /* And the flood image must be drawn INSIDE the world transform, at the map
     origin, so the water sits on the tiles it belongs to. This is the same
     class of error as the leak being filled in device space: correct image,
     wrong coordinate space, nothing looks wrong until you look. */
  assert(wetDraw, 'the flood image was never drawn — the water does not render');
  assert(wetDraw[2]===0 && wetDraw[3]===0,
    `flood image drawn at (${wetDraw[2]},${wetDraw[3]}) rather than the map origin — water is offset from the tiles it covers`);
  /* Its SIZE is in WORLD units, not device pixels — the draw happens inside the
     scaled transform, exactly like the geometry, so 76 tiles * TILE is correct
     and SCALE is applied by the context on the way out. (The first version of
     this assertion expected the scaled value and failed on a correct
     renderer.) */
  assert(wetDraw[4]===76*A.TILE && wetDraw[5]===76*A.TILE,
    `flood image spans ${wetDraw[4]}x${wetDraw[5]} world units, want ${76*A.TILE} — the water is not tile-aligned`);

  console.log(`  player at ${pxDev.toFixed(0)},${pyDev.toFixed(0)}; viewport centre ${CW/2},${CH/2}`);
  console.log(`  10 tiles spans ${span.toFixed(0)}px; lightmap and flood both aligned with geometry`);
}

/* ============ TEST 8: avatar art fits the collision disc =============
   The avatar was drawn with a body ellipse TILE*0.34 tall while the collision
   radius is 0.33 tiles, so the figure clipped into walls it was colliding
   with correctly. Assert the drawn geometry never exceeds the disc.        */
console.log('[8] avatar fits inside the collision disc');
{
  // geometry of drawPlayer, in tiles, relative to the player's tile centre
  const R = A.R;
  const parts = [
    ['shadow',     0.0375, 0.0750, 0.190, 0.110],
    ['boot L',    -0.088, -0.085, 0.058, 0.078],
    ['boot R',     0.088, -0.085, 0.058, 0.078],
    ['trouser L', -0.072, -0.020, 0.036, 0.050],
    ['trouser R',  0.072, -0.020, 0.036, 0.050],
    ['vest',       0,     0.025,   0.155, 0.115],
    ['arm L',     -0.170,  0.035,   0.033, 0.050],
    ['arm R',      0.170,  0.035,   0.033, 0.050],
    ['hand L',    -0.140, -0.020,   0.038, 0.042],
    ['hand R',     0.140, -0.020,   0.038, 0.042],
    ['wrench',     0.140,  0.155,   0.043, 0.028],
    ['hat dome',   0,     0.055,   0.100, 0.100],
    ['hat brim',   0,     0.105,   0.115, 0.050],
    ['radar glow',  0,    -0.135,   0.082, 0.082],
  ];
  let worst=0, worstPart='';
  for (const [name,ox,oy,rx,ry] of parts){
    // farthest corner of the rotated ellipse, conservative: treat as a circle
    const reach = Math.hypot(Math.abs(ox)+rx, Math.abs(oy)+ry);
    if (reach > worst){ worst=reach; worstPart=name; }
    assert(reach < R, `avatar part "${name}" reaches ${reach.toFixed(3)} tiles from centre, `+
                      `past the ${R} tile collision radius`);
  }
  console.log(`  widest avatar part "${worstPart}" at ${worst.toFixed(3)} tiles (limit ${R})`);

  /* The radar must be held out in front, not at the body centre, and the cone
     must originate from the same offset — otherwise the character is looking
     from somewhere other than where their hand is. The two are asserted
     separately on purpose: they can drift apart, and they used to be the same
     constant under two names in two functions. */
  assert(A.HAND_OFF > 0.05 && A.HAND_OFF < R,
    `HAND_OFF=${A.HAND_OFF} is not a plausible forward offset`);
  const src = A.drawPlayer.toString();
  assert(src.includes('HAND_OFF*TILE'), 'avatar no longer draws the radar at the hand offset');
  const vsrc = A.traceViewCone.toString();
  assert(vsrc.includes('HAND_OFF'),
    'the vision cone no longer originates at the hand offset');
  /* The avatar must be drawn at its TRUE position — never at the tile centre
     plus half a tile, which is half a tile from the point collision is resolved
     against, and reads as the figure standing in the corner of its own cell.

     This used to assert on the literal text `const x = p.x*TILE`. Render
     interpolation changed that line to `const x = (wx===undefined ? p.x : wx)
     * TILE` — the same world position whenever no interpolation is supplied — so
     a source-shape check failed on a correct renderer. Asserting the shape of
     an expression means rewriting the assertion every time the expression is
     touched, and it can only ever prove what the source looks like.

     So this measures where the pixels land, which is the claim that matters. It
     puts the player and an agent at deliberately FRACTIONAL coordinates — where
     a half-tile offset is obvious rather than invisible — draws each one, and
     reads back the first primitive of each. Both draw a contact shadow at a
     known offset from their origin as their very first mark, so the origin is
     recoverable without matching on a colour string. */
  {
    buildFloor(0, 4242);
    G.player.x = 30.25; G.player.y = 22.75;
    G.player.px = G.player.x; G.player.py = G.player.y;    // px==x: no interpolation
    const ag = G.agents[0];
    ag.x = 31.4; ag.y = 23.1; ag.px = ag.x; ag.py = ag.y; ag.rise = 1;
    A.snapMask();

    const px = G.player.x*A.TILE, py = G.player.y*A.TILE;
    const ax = ag.x*A.TILE,       ay = ag.y*A.TILE;
    /* A half tile is TILE/2, and none of these three marks may sit there. */
    const HALF = A.TILE*0.5;

    calls.list.length = 0;
    A.drawPlayer(G.player, 1000);
    const pFirst = calls.list.find(c=>c[0]==='ellipse');
    assert(pFirst, 'the avatar drew no ellipse at all — cannot locate it');
    /* contact shadow, centred at (x+1.5, y+3) */
    assert(Math.abs(pFirst[1]-(px+1.5)) < 0.01 && Math.abs(pFirst[2]-(py+3)) < 0.01,
      `avatar drawn at (${pFirst[1]},${pFirst[2]}) but its collision point is `+
      `(${px.toFixed(1)},${py.toFixed(1)}) tiles`);
    assert(Math.abs(pFirst[1]-(px+HALF+1.5)) > 0.01,
      'avatar is drawn half a tile from its collision point');

    calls.list.length = 0;
    A.drawAgent(ag, 1000);
    const aEllipse = calls.list.find(c=>c[0]==='ellipse');
    assert(aEllipse, 'the agent drew no ellipse at all — cannot locate it');
    /* the agent's first mark is its shadow ellipse, centred on (x, y+4) */
    assert(Math.abs(aEllipse[1]-ax) < 0.01 && Math.abs(aEllipse[2]-(ay+4)) < 0.01,
      `agent drawn at (${aEllipse[1]},${aEllipse[2]}) but its collision point is `+
      `(${ax.toFixed(1)},${ay.toFixed(1)}) tiles`);
    assert(Math.abs(aEllipse[1]-(ax+HALF)) > 0.01,
      'agents are drawn half a tile from their collision point');
    console.log(`  drawn at true fractional points (${px.toFixed(1)},${py.toFixed(1)}) and `+
                `(${ax.toFixed(1)},${ay.toFixed(1)}) tiles, not tile centre`);
  }
  console.log(`  radar held ${A.HAND_OFF} tiles in front of the body centre; cone originates there too`);
}

/* ============ TEST 18: a level is FINISHABLE, pipes and all =========
   The whole level is one objective set — every riser, then the door — so it
   has to be inside the completion path the end-to-end bot already walks. This
   drives the bot at one riser, then the next, then the door it came in by, and
   asserts the level actually completes through the real update() with real key
   state. Level 5 is the one that matters: four pipes is where a placement bug
   or a tally bug shows up, because with one there is nothing to get wrong. */
console.log('[18] end-to-end — the bot seals every riser, then walks back out');
{
  const W=76, IDX=(x,y)=>y*W+x;

  /* --- navigation: the SAME path machinery test 4 uses, pointed at a pipe --- */
  function bfsPath(sx,sy,gx,gy){
    if(sx===gx && sy===gy) return [];
    const prev=new Int32Array(W*W).fill(-1);
    const st=IDX(sx,sy), goal=IDX(gx,gy);
    if(G.grid[st]!==1||G.grid[goal]!==1) return null;
    prev[st]=st; const q=[st];
    for(let h=0;h<q.length;h++){
      const c=q[h];
      if(c===goal) break;
      const cx=c%W, cy=(c/W)|0;
      for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if(nx<0||ny<0||nx>=W||ny>=W) continue;
        const ni=ny*W+nx;
        if(G.grid[ni]!==1||prev[ni]>=0) continue;
        prev[ni]=c; q.push(ni);
      }
    }
    if(prev[goal]<0) return null;
    const out=[]; let c=goal;
    while(c!==st){ out.push([c%W,(c/W)|0]); c=prev[c]; }
    out.push([sx,sy]);
    return out.reverse();
  }

  /* The door is a WALL tile, so the bot cannot path TO it — it has to path to
     the floor tile beside it, which is the same thing the game itself does when
     it checks whether you are close enough to cycle the door. */
  function doorGoal(door){
    const cand=[[door.x+1,door.y],[door.x-1,door.y],[door.x,door.y+1],[door.x,door.y-1]]
      .filter(([x,y])=>x>=0&&y>=0&&x<W&&y<W&&G.grid[IDX(x,y)]===1);
    return cand.length ? {x:cand[0][0], y:cand[0][1]} : null;
  }

  /* Every level, because the level table is the thing under test: if level 3
     is unreachable where level 2 is fine, only walking all five finds it. */
  let arrived=0, descended=0, noPath=0, risersSealed=0, risersWanted=0;
  for (let s=0; s<A.LEVELS_N; s++){
    buildFloor(s, s*4441+13);
    A.STATE='play';
    A.floorIdx=0; A.lives=3;
    risersWanted += G.leaks.length;

    let path=null, wi=0, fromX=-99, fromY=-99, done=false;
    let swapped=false, hasMovedLastFrame=false;
    let goal=null, goalId=-1;
    let frames=0;
    let sealedThisLevel=0, allSealed=false;
    const f0 = A.floorIdx;
    const door=G.exitTiles[0];

    while (frames < 60*240 && !done){
      frames++;
      const px=G.player.x, py=G.player.y;
      keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;

      /* ONE goal at a time: the nearest open riser, or the door once the work
         is done. Recomputed from scratch every frame so that a riser sealing
         mid-walk hands the level straight over to the next one — which is the
         behaviour a player gets, and the one a stale cached goal would break. */
      let best=null, bd=Infinity;
      for(const L of G.leaks){
        if (L.fixed) continue;
        const d=Math.hypot(L.sx-px, L.sy-py);
        if (d<bd){ bd=d; best={x:L.sx, y:L.sy}; }
      }
      goal = best || doorGoal(door);
      if (!goal){ noPath++; break; }
      if (IDX(goal.x,goal.y)!==goalId){ goalId=IDX(goal.x,goal.y); path=null; }

      /* once we are on the pipe, STOP. The repair is a hold, not a walk.
         As in test 4, the question is the GAME's reach predicate and not a
         radius invented here. 0.35 is inside the game's 1.25, so a single-axis
         presser that stops 0.4 tiles short would never trigger it. */
      if (!best && Math.hypot(door.x+0.5-px, door.y+0.5-py) < 1.25){
        /* Snapshotted BEFORE the update, and that ordering is the whole reason
           this works: the frame the door cycles, nextFloor() rebuilds G for the
           NEXT level, so anything read after it belongs to a level this bot has
           never played. */
        sealedThisLevel = G.leaks.filter(l=>l.fixed).length;
        allSealed = sealedThisLevel===G.leaks.length;
        update(1/60);
        if (A.STATE!=='play') A.STATE='play';
        if (A.floorIdx>f0){
          done=true; descended++;
          risersSealed += sealedThisLevel;
          if (allSealed) arrived++;
        }
        continue;
      }
      if (best && A.leakReach(px, py)){
        update(1/60);
        if (A.STATE!=='play') A.STATE='play';
        continue;
      }

      const stale = !path || wi>=path.length ||
                    Math.hypot(px-fromX, py-fromY) > 2.5;
      if (stale){ fromX=px; fromY=py; path=bfsPath(Math.floor(px),Math.floor(py),goal.x,goal.y); wi=0; }
      if (!path){ noPath++; break; }
      while (wi<path.length-1 && Math.hypot(path[wi][0]+0.5-px, path[wi][1]+0.5-py) < 0.45) wi++;
      /* bfsPath returns [] when the player is ALREADY on the goal tile. That is
         arrival, not failure, and `path[Math.min(wi, -1)]` used to dereference
         undefined on it — a crash the door placement change exposed, because the
         bot now parks exactly on the tile below the door, which is the goal.
         Standing still is the right move here anyway: both arrival checks, the
         leak reach and the 1.25-tile door proximity, run at the top of the next
         frame. */
      const wp = path.length ? path[Math.min(wi,path.length-1)] : [goal.x, goal.y];
      const dx=(wp[0]+0.5)-px, dy=(wp[1]+0.5)-py;

      /* The steering from test 4, which is the version that actually walks a
         maze. Pressing one axis blindly — which is what this did first — jams
         against a partition and stays jammed. The two things that matter are a
         LOOKAHEAD that refuses to press into a wall, and FLIPPING the axis
         preference when the last press produced nothing. */
      const X=[dx>0?'d':'a', dx>0?1:-1, 0];
      const Y=[dy>0?'s':'w', 0, dy>0?1:-1];
      const wantFirst = Math.abs(dx)>Math.abs(dy);
      const opts = (wantFirst!==swapped) ? [X,Y] : [Y,X];
      if(!hasMovedLastFrame) swapped=!swapped;
      hasMovedLastFrame=false;
      let moved=false;
      for (const [k2,ux,uy] of opts){
        if (Math.abs(ux*dx)+Math.abs(uy*dy) < 0.06) continue;
        if (!blocked(px+ux*0.15, py+uy*0.15, 0.33)){ keys[k2]=true; moved=true; break; }
      }
      if (!moved){
        for (const [k2,ux,uy] of opts){
          if (Math.abs(ux*dx)+Math.abs(uy*dy) < 0.06) continue;
          if (!blocked(px+ux*0.2, py+uy*0.2, 0.30)){ keys[k2]=true; break; }
        }
      }
      const bx0=G.player.x, by0=G.player.y;
      update(1/60);
      if (Math.abs(G.player.x-bx0)+Math.abs(G.player.y-by0) > 1e-6) hasMovedLastFrame=true;
      if (A.STATE!=='play') A.STATE='play';       // respawn on death, keep trying
    }
    if (process.env.V) console.log(`     level ${s}: ${frames} frames, ${sealedThisLevel} pipes, ${allSealed?'all sealed':'LEFT OPEN'}`);
  }
  keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
  assert(noPath===0, `${noPath} legs had no path — the objective is unreachable`);
  assert(arrived===A.LEVELS_N, `the bot sealed every riser on ${arrived}/${A.LEVELS_N} levels`);
  assert(risersSealed===risersWanted,
    `${risersSealed}/${risersWanted} pipes were sealed — the tallies do not agree`);
  assert(descended===A.LEVELS_N, `the bot walked back out on ${descended}/${A.LEVELS_N} levels`);
  console.log(`  bot: ${risersSealed} pipes sealed, ${descended}/${A.LEVELS_N} levels walked back out`);
  A.floorIdx=0;
}

/* ============ TEST 19: the leak is actually DRAWN =============================
   Test 5 renders 400 frames and throws no exception, and the leak visual was
   absent from every one of them. It was being filled at WORLD coordinates in
   the one pass that runs after ctx.restore(), so it landed at raw pixel 1360
   and off the edge of a 1218px canvas — correctly sized, correctly gated,
   correctly computed, and completely invisible.

   The general shape of that bug is not specific to the leak: anything drawn
   after the world transform is restored has to convert coordinates itself, and
   nothing about the arithmetic looks wrong. So this test does what test 5
   cannot and checks WHERE the pixels landed — if the pipe is on screen, the
   pipe's tile must have changed colour. */
console.log('[19] the leak is drawn where it is, not just where it is computed');
{
  const W=76;
  buildFloor(2, 2468);
  for (let i=0;i<60*40;i++) update(1/60);          // let the pipes actually stain
  const L=G.leaks.find(l=>!l.fixed) || G.leaks[0];

  // stand on the repair spot facing the pipe, so it is on screen and lit
  G.player.x=L.sx+0.5; G.player.y=L.sy+0.5;
  G.player.face=Math.atan2((L.y+0.5)-G.player.y,(L.x+0.5)-G.player.x);
  /* Let the room crossfade SETTLE before asserting anything about the mask.
     Teleporting the player starts a 0.3s scope transition, and snapMask()
     retraces the cone but does not finish the fade — so a mask read three
     frames after arriving is a half-faded value and the pipe looks dim for
     reasons that have nothing to do with the pipe. */
  for (let i=0;i<40;i++){ G.player.x=L.sx+0.5; G.player.y=L.sy+0.5; update(1/60); }
  A.snapMask();

  assert(A.onScreen(L.x+0.5, L.y+0.5),
    'the pipe is not on screen while standing on it — the test cannot check what it cannot see');
  assert(A.internals.maskArr[L.y*W+L.x] > 0.9,
    `the pipe tile is masked to ${A.internals.maskArr[L.y*W+L.x]} while the player stands on it`);

  /* the camera has to be ON the player before a pixel comparison means
     anything; render() smooths it, so settle it the way the game does */
  const camx0 = (function(){ render(1000); return 1; })();
  void camx0;
  for (let i=0;i<90;i++) render(1000+i*16.7);

  /* Where the pipe should land, in device pixels. The camera has to be settled
     first or this measures the smoothing instead of the drawing. */
  const tileScreen = (tx,ty)=>{
    const T=A.TILE*A.SCALE, cx=A.cvs.width/2, cy=A.cvs.height/2;
    return [Math.round(cx+(tx-G.player.x)*T), Math.round(cy+(ty-G.player.y)*T)];
  };
  for (let i=0;i<90;i++) render(1000+i*16.7);
  const [lx,ly] = tileScreen(L.x, L.y);
  const onCanvas = lx>=0 && ly>=0 && lx<A.cvs.width && ly<A.cvs.height;
  assert(onCanvas,
    `the pipe projects to (${lx},${ly}), outside a ${A.cvs.width}x${A.cvs.height} canvas`);
  if (onCanvas){
    /* The stub canvas does not rasterize, so this checks the DRAW CALL rather
       than the pixels: something has to actually be painted at the pipe. The
       regression this exists for filled at world coordinates and so painted
       1360px to the right of where the pipe is — every one of these calls
       existed, all of them were the right size and the right colour, and not
       one of them was anywhere near the pipe. */
    calls.list.length = 0;
    render(1000+91*16.7);
    const near = calls.list.filter(c=>{
      if (c[0]!=='fillRect' && c[0]!=='createLinearGradient' && c[0]!=='createRadialGradient') return false;
      const x=c[c.length-2], y=c[c.length-1];
      return Math.hypot(x-lx, y-ly) < A.TILE*A.SCALE*1.2;
    });
    assert(near.length>0,
      `nothing is drawn within a tile of the pipe at (${lx},${ly}) — `+
      `${calls.list.filter(c=>c[0]==='fillRect').length} fills happened, none of them at the pipe`);
  }

  /* and the progress ring: it must be painted while wrenching, which is the
     only moment-to-moment feedback the repair gives */
  {
    G.player.x=L.sx+0.5; G.player.y=L.sy+0.5;
    for (let i=0;i<120;i++){ G.player.x=L.sx+0.5; G.player.y=L.sy+0.5; update(1/60); }
    assert(L.repair>1.5, `only ${L.repair}s of progress after two seconds held`);
    /* The ring is drawn at the CENTRE of the repair tile, and it is drawn with an
       arc and a stroke — so it is asserted on those. Looking for the leak's
       gradients instead measured the stain on the wall one tile away, which is
       a different object and, for a pipe north or south of the spot, exactly
       the 1.5-tile tolerance boundary: a test that passes or fails on the seed. */
    const [rx,ry] = tileScreen(L.sx+0.5, L.sy+0.5);
    calls.list.length = 0;
    render(1000+200*16.7);
    const arcs = calls.list.filter(c=>
      c[0]==='arc' && Math.hypot(c[1]-rx, c[2]-ry) < A.TILE*A.SCALE*0.75);
    assert(arcs.length>=2,
      `no ring is painted on the spot while the repair runs `+
      `(repair ${L.repair.toFixed(2)}s, ${arcs.length} arcs at the spot, `+
      `${calls.list.filter(c=>c[0]==='arc').length} arcs drawn in total)`);
    /* two arcs and a stroke: the dark track and the filled portion. One arc
       alone would be the outline of something. */
    assert(calls.list.some(c=>c[0]==='stroke'),
      'the ring was traced but never stroked — it is a circle nobody can see');
  }
  console.log('  the pipe and the wrench ring land on screen, not off in device-pixel space');
}

/* ============ TEST 28: the cast — the Rigger and the Stalker ============
   Two sprites, inlined in game.js. Two of their properties are mechanics and
   are asserted here as such: a rig that does not move its feet when it walks
   is a picture of a person, and a rig that still moves them while standing
   still is a bug in the gait. Both directions are checked against the recorded
   draw calls of the sprite's own drawing code — the same code the game calls. */
console.log('[28] the cast — the Rigger walks, the Stalker does not grow');
{
  /* A canvas stub that records EVERYTHING, including the translation stack.
     The translation matters: a boot is drawn as translate(foot) then an
     ellipse at the origin, so a recorder that keeps only the path arguments
     sees every boot at (0,0) and concludes nothing about the sprite reaches
     forward of the origin — which is what a boot is. */
  const recCtx = () => {
    const log = [];
    const c = { log, canvas:{width:1,height:1}, tx:0, ty:0, stack:[] };
    c.save  = ()=>{ c.stack.push([c.tx,c.ty]); log.push(['save']); };
    c.restore = ()=>{ const p = c.stack.pop(); if (p){ c.tx=p[0]; c.ty=p[1]; } log.push(['restore']); };
    c.translate = (x,y)=>{ c.tx+=x; c.ty+=y; log.push(['translate',x,y]); };
    for (const k of ['fillRect','strokeRect','ellipse','arc','rect','moveTo','lineTo',
                     'quadraticCurveTo','bezierCurveTo','closePath','fill','stroke',
                     'rotate','scale','setTransform','clearRect','fillText','drawImage',
                     'clip','arcTo','beginPath'])
      c[k] = (...a)=> log.push([k, ...a]);
    c.measureText = ()=>({width:10});
    return c;
  };
  const run = (fn, S) => {
    const c = recCtx();
    fn(c, S);
    return JSON.stringify(c.log);
  };
  const CAST = [
    ['the avatar',  A.drawRigger,  { h:1 }],
    ['the lifeform', A.drawStalker, { h:1 }],
  ];

  for (const [who, fn, extra] of CAST){
    assert(typeof fn==='function', `${who} has no draw function`);
    let threw = null;
    try {
      for (const phase of [0,0.25,0.5,0.75])
        for (const gait of [0,0.55,1])
          for (const h of [0,0.34,1]) run(fn, Object.assign({ T:40, t:1234, gait, phase }, extra, { h }));
    } catch (err) { threw = err; }
    assert(!threw, `${who} threw while drawing: ${threw && threw.message}`);
  }

  /* THE CONTRACT: at full gait the pose must depend on the phase (the feet
     are somewhere else a quarter of a cycle later) and at zero gait it must
     not (a standing avatar is symmetric whichever way it last faced). */
  for (const [who, fn] of CAST){
    const a = run(fn, { T:40, t:1234, h:1, gait:1, phase:0.25 });
    const b = run(fn, { T:40, t:1234, h:1, gait:1, phase:0.75 });
    assert(a!==b, `${who}: identical drawing at phase .25 and .75 while walking — it does not move`);
    const c = run(fn, { T:40, t:1234, h:1, gait:0, phase:0.25 });
    const d = run(fn, { T:40, t:1234, h:1, gait:0, phase:0.75 });
    assert(c===d, `${who}: the pose still depends on the gait clock while standing still`);
  }

  /* THE RIGGER puts its feet forward of the origin and off the centreline,
     because local -y is where it walks and a symmetric sprite has no feet to
     swing. */
  {
    const c = recCtx();
    A.drawRigger(c, { T:40, t:0, h:1, gait:1, phase:0.25 });
    assert(c.log.length > 20, `the rigger makes only ${c.log.length} draw calls — that is a silhouette, not a rig`);
    let tx = 0, ty = 0, most = 0, footmost = 0;
    for (const call of c.log){
      const [k, a, b] = call;
      if (k === 'translate'){ tx += a; ty += b; continue; }
      if (k === 'restore'){ tx = 0; ty = 0; continue; }
      if (k !== 'ellipse' && k !== 'arc' && k !== 'rect' && k !== 'fillRect') continue;
      if (typeof b !== 'number') continue;
      most = Math.min(most, ty + b);
      if (ty + b < -0.5 && Math.abs(tx) > 0.5) footmost = Math.min(footmost, ty + b);
    }
    assert(most < -2, `the rigger reaches nothing forward of the origin (closest y = ${most.toFixed(2)}px) — it cannot be walking into anything`);
    assert(footmost < -3, `the rigger has no off-centre shape forward of the origin (closest y = ${footmost.toFixed(2)}px) — no feet to swing`);
  }

  /* THE STALKER DOES NOT GROW, AND IS TWICE THE PLUMBER. It is full size on
     the first frame it draws, so the recorded geometry is compared across the
     whole rise range with the gait clock and the wall clock pinned — a single
     stray h term shows up as a difference. globalAlpha is a property rather
     than a call, so the rise's one legitimate job, fading the thing in, never
     reaches this string. */
  {
    const shapeAt = (h) => run(A.drawStalker, { T:40, t:1234, h, gait:1, phase:0.25 });
    assert(shapeAt(0.05)===shapeAt(1),
      'the stalker changes shape as it rises — its size must not depend on the rise at all');

    /* measured, not asserted from a constant: the vertical extent of each
       sprite is taken from its own recorded geometry, so "twice as big" is a
       fact about the drawing rather than a number in a comment */
    const extent = (fn) => {
      const c = recCtx();
      fn(c, { T:40, t:0, h:1, gait:1, phase:0.25 });
      let tx = 0, ty = 0, top = 1e9, bot = -1e9;
      for (const call of c.log){
        const [k, a, b] = call;
        if (k === 'translate'){ tx += a; ty += b; continue; }
        if (k === 'restore'){ tx = 0; ty = 0; continue; }
        if (k !== 'ellipse' && k !== 'arc' && k !== 'rect' && k !== 'fillRect') continue;
        const cy = ty + b, cx = tx + a;
        const r = Math.abs(call[4] || call[3] || 0);
        top = Math.min(top, cy - r);
        bot = Math.max(bot, cy + r);
      }
      return bot - top;
    };
    const riggerH = extent(A.drawRigger), stalkerH = extent(A.drawStalker);
    assert(stalkerH > riggerH * 1.5,
      `the stalker is ${stalkerH.toFixed(0)}px tall against the rigger's ${riggerH.toFixed(0)}px — it is not twice the plumber`);
    assert(stalkerH < riggerH * 4,
      `the stalker is ${stalkerH.toFixed(0)}px tall against the rigger's ${riggerH.toFixed(0)}px — past twice the plumber and into the room`);

    /* THE HIT ZONE IS DRAWN AT THE KILL RADIUS. brush() is fatal at CATCH_R
       tiles; the disc under the Stalker is that radius, so the part that can
       touch you is visible. Asserted against the constant, so a sprite that
       draws a different disc than the one that kills you cannot pass. */
    const c = recCtx();
    A.drawStalker(c, { T:40, t:0, h:1, gait:1, phase:0.25, danger:1 });
    const want = 40 * 0.52;
    let found = null;
    for (const call of c.log){
      const [k, a, b, rx] = call;
      if ((k==='ellipse' || k==='arc') && Math.abs(rx - want) < 1){ found = call; break; }
    }
    assert(found, `the stalker draws no disc at the ${want.toFixed(1)}px kill radius — the hit zone is invisible`);
  }

  /* the game draws these two and nothing else: no table, no index, no clamp */
  const src = readSrc();
  assert(/drawRigger\(ctx, \{ T:TILE, phase, gait: p\.moving \? 1 : 0, t \}\)/.test(src),
    'drawPlayer no longer draws the Rigger');
  assert(/drawStalker\(ctx, \{ T:TILE, h, phase: \(t\*0\.0009\) % 1, gait, t,/.test(src),
    'drawAgent no longer draws the Stalker');
  assert(!/SPRITES/.test(src), 'game.js still dispatches through a sprite table');
  assert(!/setSkin/.test(src), 'game.js still carries a skin selector');
  /* and the lifeform is clipped to the floor, so its legs cannot stride over a
     partition — an unclipped leg reads as walking through walls */
  const asrc = A.drawAgent.toString();
  assert(/ctx\.clip\(\)/.test(asrc), 'the lifeform is no longer clipped to the floor');
  assert(/G\.grid\[ty\*MAP_W\+tx\]===FLOOR/.test(asrc), 'the floor clip no longer reads the grid');
  assert(/CATCH_R/.test(src), 'the hit zone is not drawn at the kill radius');

  const html = readHtml();
  assert(!html.includes('sprites.js'), 'index.html still loads sprites.js');

  /* and both survive a real frame — a stub gap in a sprite kills the render,
     not one assert */
  buildFloor(0, 4242);
  A.STATE='play';
  G.player.moving = true; G.player.stepT = 0.2; G.player.stepDur = 0.46;
  for (const a of G.agents) a.rise = 1;
  update(0.016);
  render(1000);
  for (const a of G.agents) a.rise = 0.05;
  render(2000);

  /* the sheet is gone — the cast lives in game.js and nowhere else */

  console.log('  the Rigger strides, the Stalker is full size at every rise');
  console.log('  the hit zone is drawn at the kill radius, and the legs stop at walls');
  console.log('  and both survive a real update + render');
}

/* ============ TEST 29: the canvas state stack survives a frame ============
   The Rigger used to vanish whenever a Lifeform sorted north of it, which is
   most frames in the bottom half of a floor. Cause: drawStalker pushed two
   canvas states and popped one, so drawAgent's two restores popped the wrong
   pair and its FLOOR CLIP stayed live for the rest of the frame — the player,
   drawn after it in the y-sort, was clipped to the five tiles around the
   Stalker. Nothing about the player changed; everything after the agent did.

   Asserted on the real render(), against the real stub context: no save may
   outlive the frame, and no clip may be live while the player is drawn. */
console.log('[29] canvas state — nothing outlives the frame that opened it');
{
  const c = A.ctxRef;
  const realSave = c.save, realRestore = c.restore, realClip = c.clip;
  /* A clip belongs to the state saved by the save() before it, so the model is
     a stack of clip depths — a counter cannot tell "one clip under three saves"
     from "one clip, un-released". */
  let depth = 0, clips = [], clipWhenPlayerDrawn = null;
  const liveClips = ()=> clips.length ? clips[clips.length-1] : 0;
  c.save  = function(){ depth++; clips.push(liveClips()); return realSave.call(c); };
  c.clip  = function(){ clips[clips.length-1]++; return realClip.call(c); };
  c.restore = function(){ depth--; clips.pop(); return realRestore.call(c); };
  try {
    buildFloor(0, 4242);
    A.STATE = 'play';
    /* An agent NORTH of the player is the exact y-sort order that triggered it:
       the clip is opened first and the Rigger is drawn inside it. */
    const p = G.player;
    G.agents.length = 0;
    G.agents[0] = { x:p.x, y:p.y-4, rise:1, face:0, state:'WALK', born:1, huntT:0,
                     searchT:0, target:null, path:[], stuck:0, ripT:0 };
    update(0.016);

    const real = A.ENT.player;
    A.ENT.player = (pp,t)=>{ clipWhenPlayerDrawn = liveClips(); return real(pp,t); };
    render(1000);
    A.ENT.player = real;

    assert(depth === 0, `render() finished ${depth} canvas state(s) deep — something saved without restoring`);
    assert(liveClips() === 0, `${liveClips()} clip(s) survived the frame`);
    assert(clipWhenPlayerDrawn === 0,
      `the player was drawn with ${clipWhenPlayerDrawn} clip(s) live — something earlier in the frame never released its clip`);

    /* and it does not accumulate: twenty frames leave the stack where it was */
    for (let i=0;i<20;i++){ update(0.016); render(2000+i*16); }
    assert(depth === 0, `after twenty frames the stack is ${depth} deep — the leak compounds`);
  } finally {
    c.save = realSave; c.restore = realRestore; c.clip = realClip;
  }
  console.log('  every save in a frame is popped in that frame');
  console.log('  and nothing is clipped when the player is drawn');
}

/* ============ TEST 32: the door is a door ========================
   `e.open` was written once, at placement, and never again — so every door
   on every floor rendered permanently shut, and the renderer's read of it was
   a value that could not change. The state of the one door on the floor was
   therefore a stroke alpha and a word, and the 1.5s hold had no representation
   in the world at all. None of that is visible to a bot that walks to the door
   and waits, which is why the suite was green through all of it.

   These assertions are on the field the renderer actually reads. */
console.log('[32] the door — the leaf, the facing, and the state that drives both');
{
  const settle = n => { for (let i=0;i<n;i++) A.update(1/60); };
  const standAt = (e, tiles) => {
    const DIR = { S:[0,1], N:[0,-1], E:[1,0], W:[-1,0] }[e.facing];
    G.player.x = e.x + 0.5 + DIR[0]*tiles;
    G.player.y = e.y + 0.5 + DIR[1]*tiles;
  };
  const sealAll = () => {
    for (const L of G.leaks){ L.fixed = true; L.repair = 1; }
    G.leaksOpen = 0;
  };

  for (const seed of [4242, 88, 9001]){
    /* buildFloor takes the floor number as an argument and does not touch the
       run's own floorIdx, so a loop that descends has to put it back — the
       second seed otherwise starts on floor 1 with a floor 0 layout and every
       assertion about it is about a level that does not exist. */
    A.lives=3; A.floorIdx=0; A.runTime=0;
    buildFloor(0, seed);
    const e = G.exitTiles[0];
    const tag = `seed ${seed}`;

    /* SHUT. With a pipe still open the door cannot end the level, so the leaf
       must be at zero and must STAY at zero no matter how long you stand on
       the threshold — this is the state that was silently untestable before. */
    standAt(e, 0.9); settle(30);
    assert(G.leaksOpen > 0, `${tag}: nothing is leaking, the shut state cannot be tested`);
    assert(G.descend === 0, `${tag}: descended with ${G.leaksOpen} pipe(s) open`);
    assert(e.open < 0.02, `${tag}: the leaf is ${e.open.toFixed(3)} open on a floor with pipes still leaking`);

    /* AJAR. The last seal puts it on the latch, not through it: enough swing
       to read as READY from across the room, nowhere near a floor change. */
    sealAll(); standAt(e, 4); settle(60);
    assert(e.open > 0.2 && e.open < 0.6,
      `${tag}: an armed door rests at ${e.open.toFixed(3)}, want the ajar stop near 0.34`);
    assert(A.floorIdx === 0, `${tag}: standing four tiles away ended the level`);

    /* CRANKING. On the threshold the swing follows G.descend, so the thing the
       player watches is the thing the sim is doing — and the descent itself is
       still monotonic and still gated on the pipes. */
    standAt(e, 0.9); settle(30);
    assert(G.descend > 0.3, `${tag}: the hold is not accumulating (${G.descend.toFixed(2)}s)`);
    assert(e.open > 0.34, `${tag}: the leaf did not follow the hold (${e.open.toFixed(3)})`);
    const midOpen = e.open;

    /* BACKING OFF drains the cycle, and with it the leaf — a door that stayed
       cranked open while the progress drained would be lying twice. */
    G.descend = 1.2; e.open = 0.9; standAt(e, 6); settle(60);
    assert(G.descend === 0, `${tag}: stepping off left ${G.descend.toFixed(2)}s on the clock`);
    assert(e.open < midOpen, `${tag}: the leaf stayed open after the cycle drained`);

    /* and all the way through: the hold still ends the level, once. */
    standAt(e, 0.9);
    let frames = 0;
    while (A.floorIdx === 0 && frames < 400){ A.update(1/60); frames++; }
    assert(A.floorIdx === 1, `${tag}: the hold never reached the floor change in ${frames} frames`);
    assert(G.descend === 0, `${tag}: the new floor opened with ${G.descend.toFixed(2)}s still on the door`);
    assert(G.exitTiles[0].open < 0.02, `${tag}: the new floor's door did not start shut`);
  }
  console.log('  shut on a wet floor, ajar on the latch, cranking on the hold, shut again after');
  console.log('  the new floor, and the facing names the side with floor on it');
}

/* ============ TEST 33: the noise meter ==========================
   The NOISE bar was drawn as G.noise/BATT_MAX — a sprint at 1.0 filled 1% of it
   and the door at 1.8 filled 1.8%, while the `hot` class fired on the raw level
   and turned the bar red at a level it could not show. Every value in the game
   is between 0 and 1.8, and the bar is divided by 100.

   Nothing in the sim noticed: the level is played by a bot, the HUD is read by
   a human, and a bar nobody in the suite looks at can be wrong forever. These
   are the numbers on the instrument, and the instrument is what tells the player
   what the Lifeform is hearing. */
console.log('[33] the noise meter — the scale, the marks, and the pipe that emits');
{
  A.lives=3; A.floorIdx=0;
  buildFloor(1, 60606);
  const W = 76;
  const H = A.HUD;
  const show = (n, leakTotal) => {
    G.noise = n; G.selfNoise = n; G.noisePeak = n; G.leakTotal = leakTotal||0;
    A.updateHUD();
  };
  const bar = () => parseFloat(H.noise.style.width);
  const val = () => parseInt(H.vNoise.textContent, 10);
  const pct = p => p/A.NOISE_FS*100;          // exact, not rounded: the bar is
  const near = (got, want, what) =>           // drawn from the same division
    assert(Math.abs(got-want) < 0.01,
      `${what} is ${got.toFixed(2)}%, expected ${want.toFixed(2)}%`);

  /* the scale itself: each number the game can produce, at its own value */
  show(0.22); const walk = bar();
  show(0.30); const wade = bar();
  show(A.LOUD); const loud = bar();
  show(A.SPRINT_NOISE); const sprint = bar();
  show(A.REPAIR_NOISE); const wrench = bar();
  show(A.DOOR_NOISE); const door = bar();

  near(walk, pct(0.22), 'walking');
  near(wade, pct(0.30), 'wading');
  near(loud, pct(A.LOUD), 'LOUD — the threshold has no position on the instrument');
  /* 0.72 of 0.85 is 84.7%: the bar says 85, which is the whole claim. Asserted
     at the rounding the player actually sees, not at a number picked to make a
     test tidy. */
  assert(Math.abs(sprint-85) < 0.5, `a sprint fills the bar to ${sprint.toFixed(1)}%, expected 85`);
  near(wrench, 100, 'the wrench, the loudest sustained thing you do');
  near(door, 100, 'the door — past full scale is clamped, not overflowing');
  assert(val()===100, `the number beside the bar reads ${val()} at the wrench`);
  assert(walk < wade && wade < loud && loud < sprint && sprint < wrench,
    `the bar does not rank the actions the AI ranks (${walk}, ${wade}, ${loud}, ${sprint}, ${wrench})`);
  /* and the threshold is marked where it actually is, from the constant */
  near(parseFloat(H.noiseLoud.style.left), pct(A.LOUD), 'the LOUD hairline');

  /* and the red is LOUD, on YOUR noise, not a stale copy of it. 0.45 was
     hard-coded next to a threshold that lives at 0.5. */
  show(0.46);
  assert(!H.noiseWrap.classList.contains('hot'),
    'the bar goes red below LOUD — it is still testing the old 0.45');
  show(A.LOUD);
  assert(H.noiseWrap.classList.contains('hot'), 'LOUD does not turn the bar red');

  /* the standing hiss of the open pipes, as its own fill UNDER yours. It is the
     number the agents steer by, and it is not about you. */
  show(0.22, 0.24);
  near(parseFloat(H.noiseLeak.style.width), pct(0.24), 'the leak fill');
  show(0.22, 0);
  assert(H.noiseLeak.style.width==='0%', 'the leak fill is still drawn with every pipe sealed');

  /* --- and the thing this whole split exists for: standing still ---
     Standing beside a burst pipe used to fill the bar to the top, which reads as
     "you are screaming" when you are standing perfectly still and something is
     on its way to the PIPE. Your share has to be zero when you have done
     nothing, and the building's has to still be there. */
  {
    buildFloor(1, 60606);
    const L = G.leaks.find(l=>!l.fixed);
    /* two tiles from the pipe, not ON it: standing inside REPAIR_REACH starts a
       repair, and a repair is the loudest thing you can do — which is the whole
       point of it, and not what this block is about */
    let spot = null;
    for (let r=2; r<=4 && !spot; r++)
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
        const nx=L.sx+dx*r, ny=L.sy+dy*r;
        if (nx<0||ny<0||nx>=W||ny>=W) continue;
        if (G.grid[ny*W+nx]===1 && !A.leakReach(nx+0.5, ny+0.5)){ spot={x:nx+0.5,y:ny+0.5}; break; }
      }
    assert(spot, 'no walkable tile outside repair reach near the pipe on this floor');
    G.player.x = spot.x; G.player.y = spot.y;
    keys['d']=keys['w']=keys['a']=keys['s']=false; keys['shift']=false;
    for (let i=0;i<180;i++) update(1/60);
    A.updateHUD();
    assert(G.selfNoise===0,
      `standing still for three seconds left ${G.selfNoise.toFixed(2)} of your own noise on the meter`);
    assert(bar()===0, `your fill reads ${bar()}% while standing still`);
    assert(G.leakTotal>0 && parseFloat(H.noiseLeak.style.width)>0,
      'the pipes are open and the bar shows no building noise either — it is showing nothing at all');
    const seen = parseInt(H.vNoise.textContent, 10);
    assert(seen>0, `the number reads ${seen} next to an open pipe — the loudest thing in earshot is silent`);
    console.log(`  standing still two tiles from an open pipe: your fill 0%, the pipes' `+
      `${parseFloat(H.noiseLeak.style.width).toFixed(0)}%, the number reads ${seen}`);

    /* ...and it is there the moment you move, and gone when you stop */
    keys['d'] = true;
    for (let i=0;i<20;i++) update(1/60);
    A.updateHUD();
    /* wet boots are louder than dry ones, and this spot may be flooded — so the
       number to check is the one the movement stage itself used */
    const stepPower = A.wetAt(G.player.x, G.player.y) > 0.25 ? 0.30 : 0.22;
    near(G.selfNoise, stepPower, 'your own noise after twenty frames of walking');
    keys['d'] = false;
    for (let i=0;i<40;i++) update(1/60);          // 0.66s of decay at 1.55/s
    A.updateHUD();
    assert(G.selfNoise===0, `your noise is still at ${G.selfNoise.toFixed(2)} a second after you stopped`);
  }


  /* and the peak, because a sprint is 0.26s long and the fill alone cannot say
     whether it happened */
  /* below full scale, so the decay is visible at all — a peak of 1.0 would sit
     clamped at the right-hand end for its whole life */
  show(0.1); G.noisePeak = 0.6; A.updateHUD();
  /* one frame of decay (0.004) happens before the draw, so the tick sits a
     fraction under the level it is holding */
  near(parseFloat(H.noisePeak.style.left), pct(0.6-0.004), 'the peak tick');
  const before = parseFloat(H.noisePeak.style.left);
  for (let i=0;i<30;i++) A.updateHUD();
  const after = parseFloat(H.noisePeak.style.left);
  assert(after < before, `the peak tick never came down (${before}% -> ${after}%)`);

  /* --- and it holds up while the game is actually being played, which is the
     only place the numbers above are a lie if the sim does not produce them --- */
  buildFloor(1, 60606);
  keys['d'] = true;
  for (let i=0;i<24;i++) update(1/60);
  A.updateHUD();
  const moving = bar();
  keys['shift'] = true;
  for (let i=0;i<12;i++) update(1/60);
  A.updateHUD();
  const running = bar();
  keys['d'] = false; keys['shift'] = false;
  assert(Math.abs(moving-pct(0.22)) < 6,
    `24 frames of walking left your fill at ${moving.toFixed(1)}%, expected about ${pct(0.22)}`);
  assert(Math.abs(running-85) < 1,
    `sprinting put your fill at ${running.toFixed(1)}%, expected 85`);
  assert(G.selfNoise >= A.SPRINT_NOISE,
    `the sprint registered as ${G.selfNoise} of your own noise, expected ${A.SPRINT_NOISE}`);
  console.log(`  walking ${moving.toFixed(0)}%, wading ${Math.round(pct(0.30))}%, LOUD ${Math.round(pct(A.LOUD))}%, `+
    `sprint ${running.toFixed(0)}%, wrench 100%, door clamps; peak ${before.toFixed(0)}% -> ${after.toFixed(0)}%`);

  /* ============ WHERE THE PIPE MAKES ITS NOISE ============
     A pipe is broken in a WALL; you stand on the floor tile beside it to wrench
     it. The noise was emitted from the wall tile — L.x/L.y, the masonry — and
     alert() hands the source coordinate straight to the entity as the place to
     walk to. So a Lifeform that heard a pipe was sent to the inside of a wall
     and stood there grinding its collision disc against brick, which is a bug
     no bot in this suite can see because a bot never walks toward a leak.

     It is asserted the way it fails: stand an entity next to an open pipe, run
     one real frame, and check that where it was told to go is a tile it can
     stand on. */
  let witness = null;
  for (const seed of [60606, 4242, 9001, 88, 31337, 2718]){
    buildFloor(1, seed);
    for (let i=0;i<12;i++) update(1/30);
    const L = G.leaks.find(l=>!l.fixed);
    if (!L) continue;
    assert(G.grid[L.sy*W+L.sx] === 1,
      `seed ${seed}: the pipe's stand tile is not walkable — the two coordinates are not what this test assumes`);
    assert(G.grid[L.y*W+L.x] !== 1,
      `seed ${seed}: the pipe is not in a wall, so there is no wrong address to give`);
    /* a walkable neighbour of the stand tile: close enough that the pipe's own
       noise reaches it, which is the whole point of a standing noise source */
    let spot = null;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      const nx = L.sx+dx, ny = L.sy+dy;
      if (nx<0||ny<0||nx>=W||ny>=W) continue;
      if (G.grid[ny*W+nx] === 1){ spot = {x:nx+0.5, y:ny+0.5}; break; }
    }
    if (!spot) continue;
    witness = { seed, L, spot, R: A.hearRadius(G.leakPower) };
    break;
  }
  assert(witness, 'no open pipe on six floors had a walkable tile beside it');

  {
    const { seed, L, spot, R } = witness;
    /* park the player at the far side of the map: the claim under test is about
       hearing, and a Lifeform that can SEE the player is hunting for a reason
       this test did not set up */
    let far = {x:1,y:1,d:-1};
    for (let y=0;y<W;y++) for (let x=0;x<W;x++){
      if (G.grid[y*W+x] !== 1) continue;
      const dd = Math.hypot(x+0.5-spot.x, y+0.5-spot.y);
      if (dd > far.d) far = {x:x+0.5, y:y+0.5, d:dd};
    }
    G.player.x = far.x; G.player.y = far.y;

    const a = G.agents[0];
    a.x = spot.x; a.y = spot.y; a.state = 'WALK'; a.born = 0; a.rise = 1; a.t = 1;
    a.target = {x:spot.x, y:spot.y};
    update(1/60);

    assert(a.state==='SEARCH',
      `seed ${seed}: an entity one tile from an open pipe (power ${G.leakPower.toFixed(2)}, `+
      `heard out to ${R.toFixed(2)}) stayed WALK — the pipe is not making a noise anything can hear`);
    const tx = Math.floor(a.target.x), ty = Math.floor(a.target.y);
    assert(a.target && G.grid[ty*W+tx] === 1,
      `seed ${seed}: the pipe drew it to tile ${tx},${ty}, which is not floor — `+
      'the noise came from the inside of a wall');
    assert(Math.hypot(a.target.x-(L.sx+0.5), a.target.y-(L.sy+0.5)) < 2,
      `seed ${seed}: it was sent ${Math.hypot(a.target.x-(L.sx+0.5), a.target.y-(L.sy+0.5)).toFixed(2)} `+
      'tiles from the pipe that called it');
    console.log(`  seed ${seed}: pipe power ${G.leakPower.toFixed(2)} heard out to ${R.toFixed(2)} tiles; `+
      `an entity beside the pipe goes SEARCH for tile ${tx},${ty}, and that tile is floor`);
  }
}

/* ============ TEST 34: the floor-clear card ==============================
   The one screen between two levels. It is asserted on three axes, because each
   of them can fail alone and none of them implies the others:

     markup    the card exists, ships hidden, and has something to press
     content   the briefing is the LEVELS row for the floor being entered, and
                the clock is the one that was left on the floor just finished
     behaviour it holds the player out of a floor that is already built and
                already running, the clock is frozen while it is up, and ENTER
                lets go with every key released
   ============================================================ */
console.log('[34] the floor-clear card — clock left, next floor, ENTER to descend');
{
  const html = fs.readFileSync(__dirname+'/index.html','utf8');
  const css  = fs.readFileSync(__dirname+'/style.css','utf8');

  const at = html.indexOf('id="screen-clear"');
  const clearHtml = at>=0 ? html.slice(at, html.indexOf('id="screen-dead"')) : '';
  assert(at>=0, 'there is no #screen-clear in index.html');
  assert(/class="screen hidden"/.test(clearHtml),
    'the clear card ships visible — it would cover the first frame of the run');
  assert(/id="btn-descend"/.test(clearHtml), 'the clear card has no button for btn-descend to bind');
  for (const id of ['clear-clock','clear-leaks','clear-forms','clear-floor','clear-sub'])
    assert(new RegExp('id="'+id+'"').test(clearHtml), `the clear card is missing #${id}`);
  assert(A.SCREENS.includes('clear'),
    `'clear' is not in SCREENS, so show()/hideAll() will never bring the card up`);

  /* --- the content: the next floor's briefing is LEVELS, not a guess --- */
  buildFloor(0, 24601);
  A.floorIdx=0;
  A.STATE = 'play';
  /* Give the finished floor a clock the card can be checked against. The build
     above reset it, so this is set after, exactly as a played level would be. */
  G.clock = 47.5;
  const spec = A.LEVELS[1];
  A.nextFloor();

  assert(A.STATE==='clear', `the descent landed in STATE '${A.STATE}', want 'clear'`);
  assert(A.floorIdx===1, `the descent left floorIdx at ${A.floorIdx}, want 1`);
  assert(Math.abs(A.clearCard.clock-47.5) < 1e-9,
    `the card reported ${A.clearCard.clock}s left, want the 47.5s the finished floor had — `+
    'the clock is being read after buildFloor threw the old floor away');
  assert(A.clearCard.leaks===spec.leaks && A.clearCard.forms===spec.forms,
    `the briefing says ${A.clearCard.leaks} bursts / ${A.clearCard.forms} lifeforms, `+
    `LEVELS[1] says ${spec.leaks} / ${spec.forms}`);
  assert(!els['screen-clear'].classList.contains('hidden'), 'show(\'clear\') left the card hidden');
  assert(els['screen-splash'].classList.contains('hidden')
      && els['screen-order'].classList.contains('hidden'),
    'the clear card came up without dismissing the screens behind it');
  assert(els['hud'].classList.contains('on')===false, 'the HUD is still lit behind the clear card');

  /* --- and the card is styled, not just present: an unstyled div inherits the
         body font, and a briefing nobody can read is a briefing nobody reads --- */
  assert(/\.clear-next\{/.test(css), 'the clear card has no stylesheet rule — it ships unstyled');
  console.log(`  card: ${A.clearCard.leaks} bursts / ${A.clearCard.forms} lifeforms on floor `+
    `${A.floorIdx+1}, ${A.clockText(A.clearCard.clock)} left on the floor behind it, ENTER to descend`);

  /* --- behaviour: the floor under the card is REAL, and its clock is not
         running. Driven through frame(), not update(): the freeze is the loop's
         gate, and update() called directly is not a state a player is ever in. --- */
  assert(G.pipes===spec.leaks && G.leaksOpen===spec.leaks,
    `the floor under the card has ${G.leaksOpen} of ${G.pipes} bursts open — it is not built`);
  const c0 = G.clock;
  let t = Date.now();
  for (let i=0;i<120;i++) A.frame(t += 1000/60);   // two seconds of real frames
  assert(Math.abs(G.clock-c0) < 1e-9,
    `the clock moved from ${c0.toFixed(2)} to ${G.clock.toFixed(2)} while the card was up — `+
    'the card is not a frozen state, so reading the next floor costs the player time');

  /* --- and it is held the way a key is: nothing is simulating underneath, and
         ENTER lets go with every key released --- */
  A.keys['w'] = true; A.keys['shift'] = true;     // the player walked to the door
  A.dismissClear();
  assert(A.STATE==='play', `dismissClear left STATE '${A.STATE}', want 'play'`);
  assert(Object.keys(A.keys).every(k=>A.keys[k]===false || A.keys[k]===undefined),
    `keys were still held after the card cleared: ${JSON.stringify(A.keys)}`);
  assert(els['hud'].classList.contains('on'), 'the HUD did not come back on after the card');
  assert(els['screen-clear'].classList.contains('hidden'), 'the clear card stayed up after descending');

  const c1 = G.clock;
  for (let i=0;i<60;i++) A.frame(t += 1000/60);
  assert(A.STATE==='play' && G.clock < c1,
    `after the card the clock stood at ${G.clock.toFixed(2)} from ${c1.toFixed(2)} — the run is not running`);

  /* --- the LAST floor goes to the win card instead: no level six --- */
  buildFloor(4, 24601);
  A.floorIdx=4;
  A.STATE = 'play';
  A.nextFloor();
  assert(A.STATE==='win',
    `clearing the fifth floor went to '${A.STATE}', want 'win' — the card must not appear with no floor after it`);
}

reportTimings();
try {
  _sa.done();
  console.log('\nALL TESTS PASSED\n');
  process.exit(0);
} catch {
  console.log(`\n${fail} FAILURE(S)\n`);
  process.exit(1);
}