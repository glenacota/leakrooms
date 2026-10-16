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

/* ============ TEST 20: settings ==========================================
   A settings screen is a place to quietly break the game, and the two ways
   that matter are specific:

   1. The store must never be able to stop the game booting. localStorage is
      absent in this harness before this change, throws on some file://
      origins, and can be disabled outright in private browsing. Every failure
      path has to return defaults.
   2. DIFFICULTY MUST NOT BE ABLE TO TOUCH THE NOISE TABLE. That table is the
      design contract — quiet noise only makes it curious — and a difficulty
      control that could push a walk above LOUD would let a player configure
      the stealth layer out of existence. This is asserted by comparing the
      noise constants across every preset, not by trusting the implementation. */
console.log('[20] settings — persistence, validation, and the difficulty contract');
{
  /* --- defaults are a complete, valid schema --- */
  {
    const S=A.SETTINGS_DEFAULTS, SC=A.SETTINGS_SCHEMA;
    for (const k of Object.keys(SC)){
      assert(Object.prototype.hasOwnProperty.call(S,k), `no default for ${k}`);
      assert(A.settingsValid(k, S[k]), `the default for ${k} (${JSON.stringify(S[k])}) is not a legal value`);
    }
    assert(Object.keys(S).length === Object.keys(SC).length,
      'the defaults and the schema disagree about how many fields there are');
    console.log(`  ${Object.keys(SC).length} settings, all with valid defaults`);
  }

  /* --- round trip --- */
  {
    global.__store.clear();
    A.resetSettings();
    A.setOption('difficulty','hard');
    A.setOption('waterContrast', 1.6);
    A.setOption('waterHue','grey');
    const raw = global.__store.get(A.SETTINGS_KEY);
    assert(raw, 'nothing was written to the store');
    /* resetSettings PERSISTS — it is the Reset button — so calling it here
       clobbers the blob we just saved. Snapshot it and put it back, which is
       exactly what a page reload does. The first version of this test called
       reset and then asserted the old values came back, which is a test of a
       Reset button, not of persistence. */
    A.resetSettings();
    assert(A.SETTINGS.difficulty==='normal', 'reset did not restore the default difficulty');
    global.__store.set(A.SETTINGS_KEY, raw);
    A.loadSettings();
    assert(A.SETTINGS.difficulty==='hard', 'difficulty did not survive the round trip');
    assert(A.SETTINGS.waterContrast===1.6, `waterContrast came back as ${A.SETTINGS.waterContrast}`);
    assert(A.SETTINGS.waterHue==='grey', 'waterHue did not survive');
    console.log('  every field survives a write / wipe / read cycle');
  }

  /* --- a corrupt blob degrades per field, not wholesale --- */
  {
    const bad  = { difficulty:'NONSENSE',        // not an enum member
                   master:'loud',                // wrong type
                   waterHue:'chartreuse',
                   waterContrast:-4,             // below the floor
                   muted:false };                // the one legal field
    global.__store.set(A.SETTINGS_KEY, JSON.stringify(bad));
    A.loadSettings();
    /* The one good field is taken... */
    assert(A.SETTINGS.muted===false && A.SETTINGS_DEFAULTS.muted===false, 'the legal field in a partly-corrupt blob was discarded');
    /* ...and every bad one falls back on its own, rather than the whole load
       being rejected because one value is nonsense. */
    assert(A.SETTINGS.difficulty==='normal', 'a bad enum was accepted');
    assert(A.SETTINGS.master===A.SETTINGS_DEFAULTS.master, 'a string was accepted for a range');
    assert(A.SETTINGS.waterHue==='slate', 'a bad hue was accepted');
    assert(A.SETTINGS.waterContrast===A.SETTINGS_DEFAULTS.waterContrast, 'a below-floor contrast was accepted');
    /* A blob written by an older build carries fields this build has no
       control for. They must be dropped, not resurrected: the whole point of
       removing a setting is that a stale store cannot put it back. */
    assert(!('vhs' in A.SETTINGS), 'a removed setting came back from a stale store');
    console.log('  a blob of nonsense keeps its one good field, rejects the rest, and drops removed fields');
  }

  /* --- unparseable, non-object, and absent all fall back --- */
  {
    for (const junk of ['not json at all', '[1,2,3]', 'null', '"a string"', '42']){
      global.__store.set(A.SETTINGS_KEY, junk);
      A.loadSettings();
      assert(A.SETTINGS.difficulty==='normal' && A.SETTINGS.master===A.SETTINGS_DEFAULTS.master,
        `a ${junk} blob did not fall back to defaults`);
    }
    global.__store.clear();
    A.loadSettings();
    assert(A.SETTINGS.difficulty==='normal', 'an absent store did not fall back to defaults');
    /* loadSettings must be a total function of the blob, not of call order —
       a field ABSENT from a valid blob falls back rather than keeping whatever
       was live. This is the regression the "load over defaults" fix prevents.
       ORDER MATTERS: setOption persists, so the partial blob has to be written
       AFTER it, or setting an option overwrites the very blob under test. */
    A.setOption('difficulty','hard');
    assert(A.SETTINGS.difficulty==='hard', 'setOption did not take effect');
    global.__store.set(A.SETTINGS_KEY, JSON.stringify({master:0.4}));
    A.loadSettings();
    assert(A.SETTINGS.difficulty==='normal',
      'loading a partial blob kept the live difficulty — the result depends on call order');
    assert(A.SETTINGS.master===0.4, 'the one present field was not applied');
    console.log('  unparseable, non-object, and absent blobs fall back; a partial blob is a total reset plus its own fields');
  }

  /* --- a store that throws must not stop the game ---
     This is the one that matters in production: Safari in private mode throws
     on setItem, and a settings screen that throws during boot takes the whole
     game with it. */
  {
    const real = global.localStorage;
    global.localStorage = {
      getItem(){ throw new Error('SecurityError'); },
      setItem(){ throw new Error('QuotaExceededError'); },
    };
    let threw=false;
    try { A.resetSettings(); A.loadSettings(); A.saveSettings(); }
    catch(e){ threw=true; }
    global.localStorage = real;
    assert(!threw, 'a throwing localStorage propagated out of the settings code — it would take the boot with it');
    assert(A.SETTINGS.difficulty==='normal', 'a throwing store left the game in a broken settings state');
    console.log('  a localStorage that throws is survivable at every entry point');
  }

  /* --- THE CONTRACT: no preset touches the noise table --- */
  {
    const noiseBefore = { LOUD:A.LOUD, repair:A.REPAIR_NOISE,
                          base:A.LEAK_NOISE_BASE, gain:A.LEAK_NOISE_GAIN,
                          wade:0.30, walk:0.22, sprint:1.0 };
    const seen = [];
    for (const k of Object.keys(A.DIFFICULTIES)){
      A.setOption('difficulty', k);
      seen.push({ k, levels:A.FLOORS, clock:A.FLOOR_CLOCK, lives:A.DIFFICULTIES[k].lives,
                  repair:A.REPAIR_TIME, hunt:A.HUNT_BASE, step:A.HUNT_STEP });
      assert(A.LOUD===noiseBefore.LOUD, `preset ${k} changed LOUD`);
      assert(A.REPAIR_NOISE===noiseBefore.repair, `preset ${k} changed the wrench noise`);
      assert(A.LEAK_NOISE_BASE===noiseBefore.base, `preset ${k} changed the leak's base noise`);
      assert(A.LEAK_NOISE_GAIN===noiseBefore.gain, `preset ${k} changed the leak's noise gain`);
      /* The five levels are the run. A preset that trimmed one made the game
         have a different number of endings depending on the menu, so every
         preset plays all five and only the pressure around them moves. */
      assert(A.FLOORS===A.LEVELS_N,
        `preset ${k} plays ${A.FLOORS} levels — the five-level run is not a setting`);
    }
    /* and the ordering that makes the stealth layer work still holds */
    assert(A.LEAK_NOISE_BASE + A.LEAK_NOISE_GAIN < A.LOUD,
      'the leak can cross LOUD under some preset — the lure becomes a hunt trigger');
    assert(A.LEAK_NOISE_BASE < 0.30, 'wading is no longer quieter than a wet step');
    assert(A.REPAIR_NOISE >= A.LOUD, 'the repair is no longer the loud decision');
    assert(seen.length===3, `expected 3 difficulty presets, saw ${seen.length}`);
    for (const p of seen) assert(p.levels>=1 && p.lives>=1 && p.clock>0, `preset ${p.k} is degenerate`);
    console.log(`  3 presets move lives/clock/repair/chase only — noise table and level count untouched`);
    console.log(`    ${seen.map(p=>`${p.k}: ${p.lives} lives, ${p.levels} levels, ${p.clock}s clock, ${p.repair}s at the pipe, chase ${p.hunt}+${p.step}/level`).join('\n    ')}`);
    A.setOption('difficulty','normal');
  }

  /* --- difficulty reaches the game, not just the store --- */
  {
    A.setOption('difficulty','hard');
    assert(A.FLOOR_CLOCK===A.DIFFICULTIES.hard.clock, `the clock is ${A.FLOOR_CLOCK}s, want ${A.DIFFICULTIES.hard.clock}s`);
    assert(A.REPAIR_TIME===A.DIFFICULTIES.hard.repairTime, 'REPAIR_TIME did not follow the preset');
    A.setOption('difficulty','normal');
    assert(A.FLOORS===A.LEVELS_N && A.REPAIR_TIME===5 && A.FLOOR_CLOCK===180,
      'normal did not restore the documented tuning');
    console.log('  the preset actually reaches FLOOR_CLOCK and REPAIR_TIME');
  }
}

/* ============ TEST 22: the shape of the run — the five levels and the clock ===
   These are RULES, not tuning: the level table is a promise about what each
   level contains and the clock is a promise about how long you get. Neither is
   observable anywhere else in the suite — test 1 checks the built levels are
   internally consistent, and test 4 checks a bot can survive, but neither pins
   the numbers, so a well-behaved refactor could quietly turn a five-level run
   into a six-riser one or a three-minute clock into a five-minute one and the
   whole file would still go green. */
console.log('[22] the run — five levels, three minutes, one door');
{
  /* --- the level table is exactly the design --- */
  assert(A.LEVELS_N===5, `the run has ${A.LEVELS_N} levels, want 5`);
  /* Level 2 was one thing in the building and became two — the committed table
     in game.js says so, and its own comment says why ("twice the work, the
     building starts paying attention"). This literal was not moved with it, so
     the assertion that exists to pin the design was the thing disagreeing with
     the design. Pin what the game actually does; if the intent really is one
     lifeform on level 2, change game.js and this together, not one. */
  const want = [[1,1],[2,2],[3,2],[4,3],[4,4]];
  assert(A.LEVELS.length===want.length, `the level table has ${A.LEVELS.length} entries`);
  for (let i=0;i<want.length;i++){
    assert(A.LEVELS[i].leaks===want[i][0],
      `level ${i+1} has ${A.LEVELS[i].leaks} leaks, want ${want[i][0]}`);
    assert(A.LEVELS[i].forms===want[i][1],
      `level ${i+1} has ${A.LEVELS[i].forms} lifeforms, want ${want[i][1]}`);
  }
  console.log(`  level table: ${A.LEVELS.map((l,i)=>`${i+1}:${l.leaks}L/${l.forms}F`).join(' ')}`);

  /* --- and the BUILT levels match the table, on every level --- */
  for (let f=0; f<A.LEVELS_N; f++){
    buildFloor(f, 90210+f*131);
    assert(G.leaks.length===A.LEVELS[f].leaks, `built level ${f+1} has ${G.leaks.length} pipes`);
    assert(G.agents.length===A.LEVELS[f].forms, `built level ${f+1} has ${G.agents.length} lifeforms`);
    assert(G.exitTiles.length===1, `built level ${f+1} has ${G.exitTiles.length} doors`);
    assert(G.clock===180, `level ${f+1} opens with ${G.clock}s, want 180`);
  }
  console.log('  every built level matches its row and opens on 3:00');

  /* --- the clock counts down, and only down --- */
  {
    buildFloor(0, 4242);
    A.STATE='play';
    A.lives=3;
    assert(G.clock===180, 'the clock does not open on 3:00');
    A.updateReal(30);
    const t1 = G.clock;
    assert(Math.abs(t1-150) < 0.02, `30 seconds of play left ${t1}s on the clock, want 150`);
    A.updateReal(10);
    assert(G.clock < t1, 'the clock stopped');
    assert(Math.abs(G.clock-140) < 0.05, `the clock is running at the wrong rate: ${G.clock}`);
    console.log(`  the clock runs at wall speed (30s of play = ${t1}s)`);
  }

  /* --- it is fatal. A deadline that only scolds you is advice, and three
         minutes of advice is not a rule. It costs a life, exactly like being
         caught, and rewinds the level. --- */
  {
    buildFloor(0, 4242);
    A.STATE='play';
    A.lives=3; A.floorIdx=0;
    G.clock = 0.5;
    A.updateReal(1);
    assert(A.STATE!=='play', 'the clock ran out and nothing happened');
    const sub = els['dead-sub'].textContent;
    assert(/CLOCK/.test(sub), `running out of time said "${sub}"`);
    assert(A.lives===2, 'running out of time cost no life');
    /* and it is announced before it is fatal, so the last thirty seconds are
       the player's to spend rather than a surprise */
    buildFloor(0, 4242);
    A.STATE='play';
    A.lives=3;
    G.clock = 30.2;
    A.updateReal(0.5);
    assert(els['flashnote'].textContent.indexOf('THIRTY')>=0,
      `the last thirty seconds were silent (flash said "${els['flashnote'].textContent}")`);
    console.log('  the clock costs a life at zero and warns at thirty');
  }

  /* --- and it does NOT run while the game is paused ---
     A deadline that keeps draining behind a menu is the one version of this
     that would make players stop opening the pause screen at all.

     Tested through the REAL loop, not through update(): update() is not
     responsible for the pause, the frame is, and calling update() directly
     while paused would be testing a rule the game does not have. */
  {
    buildFloor(0, 4242);
    A.STATE='pause';
    const before = G.clock;
    let now = Date.now();
    const realPerf = global.performance;
    global.performance = { now: ()=> now };
    try {
      now += 1000; A.frame(now);
      assert(G.clock===before, 'the clock ran down while the game was paused');
      A.STATE='play';
      now += 1000; A.frame(now);
      assert(G.clock < before, 'the clock did not run once the game was live again');
    } finally {
      global.performance = realPerf;
      /* the loop leaves its own bookkeeping advanced; restore the world */
      buildFloor(0, 4242);
    }
    console.log('  the clock is frozen while paused');
  }

  /* --- the water is slow. The front is the clock's excuse and the player's
         only map of the level, so it has to be readable: at 1.4s a tile the
         floor was a lake inside half a minute and following it downhill stopped
         being something a player does. --- */
  assert(A.LEAK_SPREAD >= 3, `the water front is ${A.LEAK_SPREAD}s per tile — that is the old, unreadable speed`);
  /* ...and the recession has to clear the building inside the clock it is
     played against. The flood reaches G.wetMaxDist, which is 82-148 tiles out
     depending on the floor, so the drain is measured against the largest of
     those rather than against the arrival pace. */
  assert(A.LEAK_RETREAT < A.LEAK_SPREAD,
    `the recession is ${A.LEAK_RETREAT}s/tile against an arrival of ${A.LEAK_SPREAD} — the drain is a mop-up`);
  /* A TYPICAL floor, not the worst one. G.wetMaxDist runs 82-148 tiles out
     depending on the floor and the seed, and a floor flooded all the way to its
     far corner SHOULD still be draining when the clock goes — that is what a
     drowned level costs you. What must not happen is a normal floor still
     soaking on the walk home, so the bound is the mid-range floor (about 110
     tiles) plus the tail after the front reaches the pipes: the last tiles fade
     from 1 to the WET_EDGE snap in roughly ln(1/0.012) time constants. */
  assert(110*A.LEAK_RETREAT + 25 < A.FLOOR_CLOCK,
    `a typical floor (110 tiles at ${A.LEAK_RETREAT}s plus the tail) does not drain inside the ${A.FLOOR_CLOCK}s clock`);
  /* The wet band between dry carpet and open flood, in tiles, on both sides.
     It is what makes the waterline read as a shore rather than a hard edge,
     and it is only a band while the two directions agree. */
  {
    const bandUp   = A.WET_RISE / A.LEAK_SPREAD;
    const bandDown = A.WET_FALL / A.LEAK_RETREAT;
    assert(bandDown >= bandUp*0.9,
      `the wet band going out is ${bandDown.toFixed(1)} tiles against ${bandUp.toFixed(1)} coming in — `+
      'the recession dries faster than the waterline leaves and the edge goes hard');
    console.log(`  soak band: ${bandUp.toFixed(1)} tiles in, ${bandDown.toFixed(1)} tiles out`);
  }
  {
    /* measured, not asserted from the constant: 20 seconds of play must not
       move the waterline more than a few tiles. */
    buildFloor(0, 6161);
    const wet0 = A.internals.wetArr.reduce((a,b)=>a+(b>0.5?1:0),0);
    A.updateReal(20);
    const wet1 = A.internals.wetArr.reduce((a,b)=>a+(b>0.5?1:0),0);
    const tiles = (wet1-wet0)/3700;
    assert(tiles < 0.10, `20 seconds grew the flood by ${(tiles*100).toFixed(1)}% of the floor — too fast to read`);
    console.log(`  20s of play spreads the water ${(tiles*100).toFixed(1)}% of the floor`);
  }

  /* --- the door is where you came in, and you never have to find it --- */
  {
    buildFloor(0, 8080);
    const door = G.exitTiles[0];
    assert(G.exitTiles.length===1, `level 1 has ${G.exitTiles.length} doors`);
    const d = Math.hypot(door.x+0.5-G.player.x, door.y+0.5-G.player.y);
    assert(d < 14, `the door is ${d.toFixed(1)} tiles from the spawn — you did not come in through it`);
    /* and nothing in the game is looking for it: there is no discovery flag to
       flip and no search to run, which is the whole difference from the three
       exits this rule replaced. */
    assert(!('found' in door), 'the door still carries a found flag — something is looking for it');
    console.log(`  the door opens ${d.toFixed(1)} tiles from the spawn, with nothing to find`);
  }

  /* --- and the win card reports the RUN, not the floor it got printed on ---
     G.stat is thrown away and rebuilt by buildFloor, so the card used to read
     the LAST level's counters: a run that sealed 1+2+3+4+4 pipes across five
     levels and died once on level 2 reported four seals and no deaths. The card
     is the only place the whole run is ever summed, so this drives a whole run
     the real way — through the start button, through nextFloor(), one real
     death and a retry — and then reads what the card actually says. */
  {
    els['btn-start'].click();                       // the real start path clears the tally
    A.STATE = 'play';
    assert(A.runStat.sealed===0 && A.runStat.deaths===0 && A.runStat.noises===0,
      `starting a run left the totals at ${A.runStat.sealed}/${A.runStat.deaths}/${A.runStat.noises}`);
    let sealed = 0, noises = 0;
    for (let f=0; f<A.LEVELS_N; f++){
      if (f>0) A.nextFloor();   // walk through the door
      A.STATE = 'play';
      assert(G.leaks.length > 0, `level ${f+1} opened with no pipes to seal`);
      for (const L of G.leaks){ A.sealLeak(L); sealed++; }
      A.emitNoise(0.3, G.player.x, G.player.y);
      A.emitNoise(0.3, G.player.x, G.player.y);
      noises += 2;
      assert(A.runStat.sealed===sealed,
        `after ${f+1} level(s) the run has sealed ${A.runStat.sealed}, want ${sealed}`);
      if (f===1){
        /* die once, on level 2, the real way — the clock, not a direct call */
        G.clock = 0.5;
        A.updateReal(1);
        assert(A.STATE==='dead', 'the death on level 2 did not happen');
        assert(A.runStat.deaths===1, `the run has ${A.runStat.deaths} deaths, want 1`);
        els['btn-retry'].click();                   // the floor is rebuilt; the tally must not be
        A.STATE = 'play';
        assert(A.runStat.deaths===1 && A.runStat.sealed===sealed,
          'retrying the level cleared the run totals');
      }
    }
    A.nextFloor();        // floorIdx hits FLOORS: the card is printed
    assert(A.STATE==='win', `the run ended on STATE=${A.STATE}, not the win screen`);
    assert(G.stat.sealed !== sealed,
      'this assertion needs G.stat to differ from the run total or it proves nothing');
    const card = els['win-stats'].innerHTML;
    assert(card.includes(`<b>${sealed}</b> pipes`),
      `the win card does not report ${sealed} sealed pipes (said: ${card.slice(0,90)}...)`);
    assert(card.includes(`Deaths: <b>1</b>`), `the win card does not report 1 death (said: ${card.slice(0,90)}...)`);
    assert(card.includes(`Noise made: <b>${noises}</b>`),
      `the win card does not report ${noises} noises (said: ${card.slice(0,90)}...)`);
    console.log(`  the win card counts the run: ${sealed} pipes sealed, 1 death, ${noises} noises`);
    /* leave the world where the next test expects to find it */
    A.STATE = 'splash';
    A.lives=3; A.floorIdx=0; A.runTime=0;
    buildFloor(0, 4242);
  }
}

/* ============ TEST 23: the audio graph actually reaches the speakers ===
   Every other test in this file runs with no AudioContext at all, so `Audio_.ok`
   is false and every voice method returns on its first line without building a
   node. That is the right way to test the fallback — and it means a game that
   makes no sound whatsoever looks identical to a game that makes all of it.

   It was one line. The master gain was connected to ITSELF:

       this.master.connect(this.master);

   which is a closed loop: every voice in the game chains up into a node that
   goes nowhere. No voice is missing, nothing throws, the volume slider tracks
   the setting — the graph simply terminates in a circle, so the game is silent
   from the splash screen to the win screen and no assertion here could see it.

   So this builds the graph for real and walks it. */
console.log('[23] audio — the graph reaches the destination');
{
  /* no AudioContext at all: the fallback must be a no-op, not a crash */
  assert(global.window.AudioContext===undefined, 'the fallback path is not being tested');
  const before = A.Audio_.ok;
  assert(before===false, 'audio came up without an AudioContext — the fallback is not guarded');
  A.Audio_.step(1); A.Audio_.seal(); A.Audio_.drone(1,0);
  assert(global.__audioNodes.length===0, 'the no-AudioContext path built nodes anyway');

  /* now give it one, and build the whole thing */
  global.__audioNodes.length = 0;
  const ctx = fakeAudioContext();
  global.window.AudioContext = function(){ return ctx; };
  A.Audio_.ctx = null; A.Audio_.ok = false;
  A.Audio_.init();
  assert(A.Audio_.ok===true, 'Audio_.init did not come up with a context available');
  assert(A.Audio_.ctx===ctx, 'Audio_.init did not keep the context it created');

  /* reachability: follow the wires from the master to the speakers. A node
     that feeds an AudioParam counts as connected — an LFO driving a filter
     cutoff has no node-path to the speakers and is not supposed to have one. */
  const reaches = (start, dest)=>{
    const seen = new Set(), q = [start];
    while (q.length){
      const n = q.pop();
      if (n===dest || (n && n._mod)) return true;
      if (!n || seen.has(n)) continue;
      seen.add(n);
      for (const o of (n._out||[])) q.push(o);
    }
    return false;
  };
  assert(reaches(A.Audio_.master, ctx.destination),
    'the master gain does not reach the audio destination — the game is silent');
  assert(A.Audio_.master._out.indexOf(A.Audio_.master) < 0,
    'the master gain is connected to itself');

  /* every voice the game builds has to end up in that graph too, or it is a
     node that runs for the whole session and reaches nobody */
  const orphans = global.__audioNodes.filter(n=>!reaches(n, ctx.destination));
  assert(orphans.length===0,
    `${orphans.length} audio nodes reach nothing (${orphans.slice(0,4).map(n=>n.kind).join(', ')})`+
    ' — the voices built so far are inaudible');

  /* and the long-running ones have to be running */
  const started = global.__audioNodes.filter(n=>n._starts>0).length;
  assert(started>=5, `only ${started} nodes were started — the hum, the hiss and the drone are silent`);

  /* every one-shot voice: build it and check it lands */
  /* Every VOICE, driven with plausible arguments. Enumerated from the object
     itself so a new sound cannot skip the test — with the shell's own methods
     named out, because those move gains and start timers rather than making a
     sound, and "built no nodes" is the correct answer for all of them. */
  const SHELL = ['init','setMaster','setMuted','unlock','ambience',
                 '_ambStart','_ambTick','_ambStop','_ambNote',
                 /* the two continuous noise beds, their silencer, and the
                    gain curve they share with the one-shots: all four move gains
                    that already exist, so "built no nodes" is the right answer */
                 'noiseFloor','leakBed','silenceBeds','powerVol'];
  const oneShots = Object.keys(A.Audio_).filter(k=>typeof A.Audio_[k]==='function'
                                               && !SHELL.includes(k));
  assert(oneShots.length>=9, `only found ${oneShots.length} voices on Audio_`);
  for (const name of oneShots){
    const args = new Array(A.Audio_[name].length).fill(0.5);
    const n0 = global.__audioNodes.length;
    A.Audio_[name](...args);
    const made = global.__audioNodes.length - n0;
    /* silence/drone/setMaster are continuous, not one-shots: they move an
       existing gain rather than building a voice, so they legitimately build
       nothing. */
    const continuous = (name==='silence'||name==='drone');
    assert(continuous || made>0, `Audio_.${name} built no nodes — it is inaudible`);
    const dead = global.__audioNodes.slice(n0).filter(n=>!reaches(n, ctx.destination));
    assert(dead.length===0, `Audio_.${name} built ${dead.length} nodes that reach nothing`);
  }

  /* ---------- THE MIX FOLLOWS THE METER ----------
     Every voice in the game is a one-shot with a fixed peak, so the bar could
     fill to its top and the speakers would not move: a sprint (1.0) and a walk
     (0.22) were 2x and 1x of the same hand-picked number, while the HUD read a
     percentage of the BATTERY maximum. Three claims here — the bed's gain
     rises with the level it is handed, the leak bed rises with the pipes and
     falls with distance, and a louder action is a louder voice. */
  {
    const gainOf = n => n.gain._scheduled;
    A.Audio_.noiseFloor(0);   const quiet = gainOf(A.Audio_.floorGain);
    A.Audio_.noiseFloor(0.5); const mid   = gainOf(A.Audio_.floorGain);
    A.Audio_.noiseFloor(1);   const full  = gainOf(A.Audio_.floorGain);
    assert(quiet===0, 'the noise floor is not silent at zero');
    assert(mid>quiet && full>mid,
      `the noise bed does not follow the bar (${quiet}, ${mid}, ${full}) — the HUD and the mix are two instruments`);

    A.Audio_.leakBed(0.5, 0);   const near = gainOf(A.Audio_.leakGain);
    A.Audio_.leakBed(0.5, 15);  const midD = gainOf(A.Audio_.leakGain);
    A.Audio_.leakBed(0.5, 40);  const far  = gainOf(A.Audio_.leakGain);
    A.Audio_.leakBed(0, 0);     const none = gainOf(A.Audio_.leakGain);
    assert(near>midD && midD>far && far===0,
      `the leak bed ignores distance (${near}, ${midD}, ${far}) — an open pipe has to be somewhere you can walk toward`);
    assert(none===0, 'a building with no water in it still has water noise in the mix');

    A.Audio_.silenceBeds();
    assert(gainOf(A.Audio_.floorGain)===0 && gainOf(A.Audio_.leakGain)===0,
      'silenceBeds left a bed open — update() has stopped, so nothing will close it');
  }

  /* ...and the one-shots are louder when they are making more noise. The peak
     is the MAX of what the gain was told, not its last value: a one-shot
     schedules an attack and then a decay to silence, so the last number is
     always 0.0001 and every voice would tie. */
  {
    const peak = (fn, ...args) => {
      const n0 = global.__audioNodes.length;
      fn(...args);
      let hi = 0;
      for (const n of global.__audioNodes.slice(n0))
        for (const v of (n.gain._hist||[])) if (v>hi) hi=v;
      return hi;
    };
    const walk   = peak(()=>A.Audio_.step(1, 0.22));
    const sprint = peak(()=>A.Audio_.step(1, A.SPRINT_NOISE));
    assert(sprint > walk*1.5,
      `a sprinting footstep peaks at ${(sprint/walk).toFixed(2)}x a walking one — the mix does not know you are running`);
    const wrench = peak(()=>A.Audio_.wrench(A.REPAIR_NOISE));
    const door   = peak(()=>A.Audio_.door(A.DOOR_NOISE));
    assert(wrench > walk, 'the wrench is quieter than a footstep');
    assert(door >= wrench, 'cycling the door is quieter than the wrench');
  }

  /* ---------- the splash bed ----------
     The title screen is the only place this plays, so "it is on while you are
     looking at the title" and "it stops when the run starts" are the two claims
     worth making, and neither is visible from the graph alone. */
  {
    const n0 = global.__audioNodes.length;
    A.Audio_.ambience(true);
    assert(A.Audio_.ambOn===true, 'ambience(true) did not turn the bed on');
    assert(global.__audioNodes.length > n0, 'the bed built no nodes — the title screen is silent');
    assert(A.Audio_._ambTimer, 'the bed has no scheduler — no note will ever be played');
    const dead = global.__audioNodes.slice(n0).filter(n=>!reaches(n, ctx.destination));
    assert(dead.length===0, `${dead.length} ambience nodes reach nothing — the bed is inaudible`);

    /* the scheduler actually schedules: push the clock forward and tick it */
    const before = global.__audioNodes.length;
    ctx.currentTime = 400;
    A.Audio_._ambTick();
    assert(global.__audioNodes.length > before,
      'the note scheduler built nothing after half a minute — the "music" is three drones');

    /* and it is quiet by construction: a bed that can out-loud the wrench is
       not a bed. Every voice it owns must start well under LOUD. */
    A.Audio_.ambience(false);
    assert(A.Audio_.ambOn===false, 'ambience(false) did not turn the bed off');
    assert(A.Audio_._ambTimer===null, 'the note scheduler survived the bed — it will keep firing forever');
    assert(A.Audio_.amb===null, 'the ambience graph was left attached after stopping');
    A.Audio_.ambience(true); A.Audio_.ambience(false);   // idempotent either way
  }

  /* M is a separate node from the volume slider, so the two cannot undo each
     other: dragging the volume while muted must not unmute. Read the SCHEDULED
     gain, which is what setTargetAtTime is told, not `.value`, which a real
     AudioParam does not write back when you schedule a ramp. */
  {
    A.Audio_.setMuted(true);
    assert(A.Audio_.mute.gain._scheduled===0, 'muting did not close the mute gain');
    A.Audio_.setMaster(1);
    assert(A.Audio_.mute.gain._scheduled===0, 'raising the volume unmuted the game — the two settings are the same node');
    assert(A.Audio_.master.gain._scheduled===1, 'the volume slider stopped working while muted');
    A.Audio_.setMuted(false);
    assert(A.Audio_.mute.gain._scheduled===1, 'unmuting did not reopen the mute gain');
    assert(reaches(A.Audio_.mute, ctx.destination), 'the mute node does not reach the speakers');

    /* ...and going through the SETTINGS STORE, not the audio method directly,
       has to move the same node. This is the exact shape of the bug where
       applySettings pushed the volume slider and forgot the mute: the flag
       saved, survived a reload, toasted "AUDIO MUTED", and left the speakers
       exactly as they were. A setting that appears to work is worse than one
       that visibly does not. */
    A.setOption('muted', true);
    assert(A.Audio_.mute.gain._scheduled===0,
      'the stored mute flag is set and the audio node is still open — the setting does nothing');
    A.setOption('muted', false);
    assert(A.Audio_.mute.gain._scheduled===1, 'unmuting through the store did not reopen the node');
    A.setOption('muted', false);
  }

  /* the volume slider is the one thing in front of all of them */
  A.Audio_.setMaster(0);
  assert(A.Audio_.masterVol===0.02, `muting gave ${A.Audio_.masterVol}, not the documented floor`);
  A.Audio_.setMaster(1);
  assert(A.Audio_.masterVol===1, 'the master volume does not track the setting');

  /* and it all has to survive being called with no context, which is what a
     browser that refuses to start one does */
  let threw='';
  A.Audio_.ctx = null; A.Audio_.ok = false;
  for (const name of oneShots) A.Audio_[name](...new Array(A.Audio_[name].length).fill(0.5));
  for (const name of SHELL) { try { A.Audio_[name](false); } catch(e){ threw=String(e && e.message); } }
  assert(!threw, 'a shell method threw with no audio context: '+threw);
  A.Audio_.silence(); A.Audio_.setMaster(0.5);
  console.log(`  ${global.__audioNodes.length} nodes built, all reaching the destination; `+
    `${oneShots.length} one-shots wired; muted to ${A.Audio_.masterVol}, no-context path is a no-op`);
  global.window.AudioContext = undefined;
}

/* ============ TEST 24: the sidebar HUD — one column, bars where bars fit

   The HUD is the one part of this game that is pure presentation, which makes
   it the one part with nothing stopping a later pass from quietly undoing it.
   Style regressions are exactly the kind that survive: the game still runs, the
   numbers are still correct, and nobody notices until someone squints.

*/
console.log('[24] the sidebar HUD — one column, bars where bars fit');
{
  const html = readHtml();
  const css  = readCss();
  const hudHtml = html.slice(html.indexOf('<div id="hud">'), html.indexOf('<!-- ============ SCREENS'));

  /* --- one column, not two clusters --------------------------------- */
  assert(/class="hud-side"/.test(hudHtml), 'the HUD has no .hud-side column');
  assert(!/hud-left|hud-right/.test(hudHtml),
    'the two top-edge clusters are still wired up — every stat should share one column');
  assert((hudHtml.match(/class="stat/g)||[]).length === 8,
    `expected 8 stats in the column, found ${(hudHtml.match(/class="stat/g)||[]).length}`);
  /* Grouped by KIND: clock alone, the three gauges, the three states, lives. */
  assert((hudHtml.match(/class="hud-div"/g)||[]).length === 3,
    'the column is not divided into its four groups');

  /* --- the play area STARTS where the panel ends --------------------
     It used to be asserted the other way round: the test pinned the HUD to one
     window edge and forbade the canvas from reserving any width for it. That is
     the overlay, and the overlay is the bug — the canvas sizes the camera, the
     ambient bake and the visibility mask to itself, so a panel painted over it
     renders a lit, scoped, masked strip of the world the player never sees, on
     the side things approach from.

     What holds now is not an EDGE but a RELATIONSHIP: the canvas is boxed by
     #stage, and #stage is inset by the panel's width. Which side it sits on is
     still not asserted — a test that fails because the author changed his mind
     is a test reporting its own history. */
  const hudRule = css.match(/#hud\s*\{([^}]*)\}/);
  assert(hudRule, 'no #hud rule');
  assert(/--side-w/.test(hudRule[1]), '#hud has no width — a sidebar needs one');
  assert(/z-index/.test(hudRule[1]),
    '#hud has no stacking level — anything painted later covers it silently');
  assert(/pointer-events\s*:\s*none/.test(hudRule[1]),
    '#hud swallows clicks — the game underneath must still be playable');

  /* the column is pinned to ONE edge, and the stage is cut back by its width.
     The two must agree on the same number: if they disagree, the panel either
     covers the map again or leaves a dead strip of black beside it. */
  const inset = ((hudRule[1].match(/inset\s*:\s*([^;]+)/)||[])[1]||'').trim().replace(/\s+/g,' ');
  const onLeft  = /^0\s+auto\s+0\s+0$/.test(inset);
  const onRight = /^0\s+0\s+0\s+auto$/.test(inset);
  assert(onLeft || onRight,
    `#hud is not pinned to one edge full-height (inset: ${inset}) — a sidebar needs an edge to sit on and the full height`);

  const stageRule = css.match(/#stage\s*\{([^}]*)\}/);
  assert(stageRule, 'no #stage rule — the canvas has no play area to live in and is back under the panel');
  const stageLeft  = ((stageRule[1].match(/left\s*:\s*([^;]+)/)||[])[1]||'').trim();
  const stageRight = ((stageRule[1].match(/right\s*:\s*([^;]+)/)||[])[1]||'').trim();
  if (onLeft) assert(stageLeft.includes('--side-w'),
    '#stage does not start at --side-w — the panel is painted over the map again');
  else       assert(stageRight.includes('--side-w'),
    '#stage does not end at --side-w — the panel is painted over the map again');
  assert(/position\s*:\s*absolute/.test(stageRule[1]),
    '#stage is not absolutely positioned — it would sit in flow and the canvas below it would still span the window');

  /* --- and the canvas is INSIDE the stage ----------------------------
     A stage that does not contain the canvas, or a canvas left on the window
     root, puts the map back under the panel one level up. */
  assert(/<div id="stage">[\s\S]*?<canvas id="game">/.test(html),
    'the canvas is not inside #stage');
  assert(/#game\s*\{[^}]*inset\s*:\s*0/.test(css),
    '#game is not filling #stage — it is sized against the window instead');

  /* --- and the map-relative text is centred on the MAP --------------
     #prompt and #flashnote are positioned left:0; right:0. Outside #stage they
     centre on the window, which is a whole panel wider than the play area on
     the left — both would sit visibly off the player they are describing. */
  const stageEnd = html.indexOf('<!-- ============ SCREENS');
  const stage = html.slice(html.indexOf('<div id="stage">'), stageEnd);
  assert(stage.includes('id="prompt"'), '#prompt is not inside #stage — it centres on the window, not the map');
  assert(stage.includes('id="flashnote"'), '#flashnote is not inside #stage — it centres on the window, not the map');

  /* --- the plate presents itself to the PLAY area, not the bezel -----
     With the map no longer behind it the fade runs into the black edge of the
     tube rather than over live geometry, so it is a bezel treatment rather
     than a readability one — but it must still point at the play area, which
     is the side the player reads against. */
  const sideRule = css.match(/\.hud-side\s*\{([^}]*)\}/);
  assert(sideRule, 'no .hud-side rule');
  const wantDeg = onLeft ? '90deg' : '270deg';
  assert(new RegExp('linear-gradient\\(\\s*'+wantDeg).test(sideRule[1]),
    `.hud-side does not fade with ${wantDeg} — on the ${onLeft?'left':'right'} that means solid at the window edge and fading out over the play area`);

  /* --- bars on battery, noise and flood, and ONLY those three --------
     Over-collecting is a real failure here, not pedantry: a bar under a count
     is actively misleading, because a half-full gradient next to "2/4" invites
     you to read the gradient as the number. */
  const stats = hudHtml.split('<div class="stat').slice(1);
  const withBar = stats.filter(s => s.includes('class="bar'));
  const barLabels = withBar.map(s => (s.match(/class="lbl">([A-Z]+)/)||[])[1]).sort();
  assert(JSON.stringify(barLabels)===JSON.stringify(['BATTERY','FLOOD','NOISE']),
    `bars are on ${JSON.stringify(barLabels)}, expected BATTERY/FLOOD/NOISE only`);
  for (const need of ['bar-batt','bar-noise','bar-flood']){
    assert(hudHtml.includes(`id="${need}"`), `the HUD is missing #${need}`);
  }

  /* --- type floors ---------------------------------------------------
     The parser has to be a little more forgiving than `font-size:NNpx`.

     It used to require exactly that, and it reported NaN on both `font-size:1rem`
     and `font-size: 30px` — a space after the colon, which is legal CSS and which
     the very first thing it read here had. That produced three failures that all
     said "NaNpx" for two entirely different reasons and neither of which was a
     problem with the game. A test that cannot parse its input is not a test; it
     is a tripwire on the author's formatting habits. rem/em are resolved against
     a 16px root, which is the browser default and nothing in this sheet overrides
     html's font-size. */
  const px = (sel)=>{
    const m = css.match(new RegExp('(^|\\})\\s*'+sel.replace(/[.#]/g,'\\$&')+'\\s*\\{([^}]*)\\}','m'));
    if (!m) return NaN;
    const s = m[2].match(/font-size\s*:\s*([\d.]+)\s*(px|rem|em)/);
    if (!s) return NaN;
    return s[2]==='px' ? Number(s[1]) : Number(s[1])*16;
  };
  assert(px('.lbl')>=11, `labels are ${px('.lbl')}px — the floor is 11`);
  assert(px('.val')>=15, `values are ${px('.val')}px — the floor is 15`);
  assert(px('#val-clock')>=22, `the clock is ${px('#val-clock')}px — it can end a level by itself, it should be the biggest thing`);
  assert(px('#val-clock')>px('.val'),
    'the clock is not larger than an ordinary value — the hierarchy is inverted');
  /* Labels sit above their numbers. Sideways means the eye travels for every
     value and the column reads as a run-on sentence instead of a list. */
  assert(/flex-direction\s*:\s*column/.test(css.match(/\.stat\s*\{([^}]*)\}/)[1]),
    '.stat is not a column — labels and values are beside each other');

  /* --- label contrast: not the floor of the palette ------------------ */
  assert(!/color\s*:\s*var\(--yellow-deep\)/.test(css.match(/\.lbl\s*\{([^}]*)\}/)[1]),
    'labels are back to --yellow-deep, the darkest yellow in the palette');

  /* --- one meaning per colour ---------------------------------------- */
  const barFlood = css.match(/\.bar\.flood i\s*\{([^}]*)\}/);
  assert(barFlood && /#3c5a60|#8fc4cc/i.test(barFlood[1]),
    'the flood bar is not blue — blue is the water\'s colour, full stop');

  /* ...and the flood NUMBER is blue, which takes two things to be true at once
     and both of them were false for a while: the span has to carry `water`, and
     it has to also carry `val`. `.val.water` is a compound selector, so dropping
     `val` in favour of a `val-bar` modifier quietly un-blues the reading and
     leaves a yellow number sitting above a blue bar — which reads as two
     different things rather than one, and undoes the whole reason the colour
     exists. Assert the class list, not the intent. */
  const floodVal = hudHtml.match(/<span class="([^"]*)"[^>]*id="val-flood"/);
  assert(floodVal, 'the flood reading has no #val-flood');
  assert(/\bwater\b/.test(floodVal[1]),
    'the flood number lost its .water class — the bar is blue and the number is not');

  /* --- `val-bar` is a MODIFIER, never a replacement -------------------
     Every value in the HUD gets `.val`: that is where the colour and the
     tabular figures live. A span carrying `val-bar` WITHOUT `val` loses both,
     silently, and nothing in the stylesheet says so — the number just comes back
     the default foreground and starts sliding sideways as its digits change,
     while every other number in the column stays put. */
  assert(!/class="val-bar[ "]/.test(hudHtml),
    'a value span uses .val-bar without also carrying .val — it loses the colour and the tabular figures');
  for (const m of hudHtml.matchAll(/<span class="([^"]*)"[^>]*id="val-[a-z]+"/g)){
    assert(/\bval\b/.test(m[1]),
      `#${m[0].match(/id="([^"]*)"/)[1]} has no .val class — it is not being styled as a HUD value`);
  }
  const shut = css.match(/#val-leak\.shut\s*\{([^}]*)\}/);
  assert(shut && /--danger|#d8503c/i.test(shut[1]),
    'the door no longer shouts in red');
  /* ...and the good state is quiet. If OPEN were the red one, the single most
     important word in the HUD would be the loudest thing on screen, which is
     backwards: OPEN means every riser is sealed and you can leave.

     NOTE the lookbehind-ish guard. The selector must be BARE `#val-leak`, not
     `#val-leak.shut` or `#val-leak .foo` — a colour on a bare #val-leak is a
     colour on every state. Written carelessly this assertion is dead: an
     alternation like /#val-leak\.open|--val-leak\{/ splits at the `|` and the
     second branch looks for `--val-leak`, two hyphens, which no selector in
     this stylesheet will ever contain. */
  assert(!/(^|[^.\w#])#val-leak\s*\{[^}]*(?:--danger|#d8503c)/.test(css),
    'the door shouts in its GOOD state — only the state that is stopping you may shout');
  assert(/^#val-leak\.shut\s*\{/m.test(css),
    'the door has no .shut rule, so the state that is stopping you cannot shout at all');

  /* --- the clock changes colour, never size -------------------------- */
  const clockRule = css.match(/#val-clock\s*\{([^}]*)\}/);
  assert(!/animation/.test(clockRule[1]),
    'the clock itself animates — a resizing number reflows its own box once a second');
  assert(/#clock\.low #val-clock\s*\{[^}]*color/.test(css), 'the clock does not change colour when it is low');

  /* --- narrow windows: a permanent column costs play area, so it sheds -- */
  assert(/max-width\s*:\s*900px/.test(css) && /max-width\s*:\s*680px/.test(css),
    'the sidebar does not respond to narrow windows — it is the one HUD shape whose cost grows as the window shrinks');

  console.log(`  ${stats.length} stats in one column, bars on ${barLabels.length} of them; `+
    `labels ${px('.lbl')}px, values ${px('.val')}px, clock ${px('#val-clock')}px, overlaying a full-width canvas`);
}

/* ============ TEST 21: the splash chain — 03 riser, 04 work order, then the run
   Two splash frames sit in front of the game now, so the path a player walks
   to reach the first frame is part of the build and has to be tested like
   one: which screen is up, what each key does, what is left held afterwards. */
console.log('[21] the splash chain — 03 riser, 04 work order, then the run');
{
  const html = readHtml();
  const css  = readCss();

  /* --- the markup contract --- */
  assert(!/screen-title/.test(html), 'the old title screen is still wired into index.html');
  const splashHtml = html.slice(html.indexOf('id="screen-splash"'), html.indexOf('id="screen-order"'));
  const orderHtml  = html.slice(html.indexOf('id="screen-order"'), html.indexOf('id="screen-pause"'));
  assert(splashHtml.length>0 && orderHtml.length>0, 'the splash or work-order screen is missing from index.html');
  assert(/LEAKROOMS/.test(splashHtml), 'splash 03 does not show the title');
  assert(!/\bhidden\b/.test(splashHtml), 'splash 03 ships hidden — the boot frame would be a blank canvas');
  assert(/class="screen hidden"/.test(orderHtml), 'work order 04 ships visible over the riser');
  assert(/id="btn-start"/.test(orderHtml), 'work order 04 has no clock-in button for btn-start to bind');

  /* --- the controls summary is the reason screen 04 exists --- */
  for (const key of ['WASD','SHIFT','ESC']){
    assert(new RegExp('>'+key+'[^<]*<').test(orderHtml), `work order 04 never lists ${key}`);
  }
  assert(/>R</.test(orderHtml), 'work order 04 never lists R, the radar');
  assert(/>M</.test(orderHtml), 'work order 04 never lists M, the mute');

  /* --- and it is legible, not merely present.
         The old title screen was 11px and nobody read it, so the requirement
         is a floor on rendered size, not the existence of the text. --- */
  const px = (sel)=>{ const m = css.match(sel); return m ? Number(m[1]) : NaN; };
  assert(px(/\.controls-big span\{[^}]*font-size:(\d+)px/)>=14,
         'the controls summary body text is under 14px');
  assert(px(/\.controls-big b\{[^}]*font-size:(\d+)px/)>=14,
         'the control keys are under 14px');
  assert(px(/\.order \.field b\{[^}]*font-size:(\d+)px/)>=15,
         'the work order body text is under 15px');
  assert(px(/\.order-head h2\{[^}]*font-size:(\d+)px/)>=20,
         'the work order title is under 20px');
  console.log(`  work order type: title ${px(/\.order-head h2\{[^}]*font-size:(\d+)px/)}px, `+
              `body ${px(/\.order \.field b\{[^}]*font-size:(\d+)px/)}px, controls ${px(/\.controls-big b\{[^}]*font-size:(\d+)px/)}px`);

  /* --- the chain itself, driven through the real key handler --- */
  const keydown = global.window._h.keydown;
  assert(typeof keydown==='function', 'no keydown handler was registered');
  const press = (key, extra={})=> keydown({ key, repeat:false, metaKey:false, ctrlKey:false,
                                            altKey:false, preventDefault(){}, ...extra });
  const vis = ()=> A.SCREENS.filter(s=>!els['screen-'+s].classList.contains('hidden'));

  A.hideAll(); A.STATE='splash'; A.show('splash');
  assert(vis().join()==='splash', `boot shows ${vis().join()||'nothing'}, expected the riser`);

  press('Enter');
  assert(A.STATE==='order', `ENTER on the riser left STATE at ${A.STATE}`);
  assert(vis().join()==='order', `ENTER showed ${vis().join()||'nothing'}, expected the work order alone`);
  assert(/^#88D-[0-9A-F]{1,4}$/.test(els['order-seed'].textContent),
    `the run seed is "${els['order-seed'].textContent}" — the stub does not carry the seed of the floor it clocks into`);

  press('Escape');
  assert(A.STATE==='splash' && vis().join()==='splash', 'ESC did not walk back to the riser');
  press('Escape');
  assert(A.STATE==='splash', 'ESC on the riser advanced anyway — there is nothing behind it');

  press('q');
  assert(A.STATE==='order', 'an ordinary key did not advance the splash');

  /* --- the terms chooser on the work order --------------------------------
     The order screen is a form while the chooser is open: the any-key advance
     has to stop clocking the player in, the number row picks a term, the
     arrows cycle, and both dismiss keys fold the chooser shut before they do
     anything else. Driven through the real handler, because the any-key
     advance is exactly the branch a chooser has to survive. */
  A.setTermsOpen(true);
  assert(A.termsOpen, 'the terms chooser did not open');

  press('w');
  assert(A.STATE==='order', 'a key with the terms chooser open clocked the player in');
  assert(!A.keys['w'], 'a key swallowed by the chooser stayed held — the player walks on spawn');

  const at = ()=> A.SETTINGS.difficulty;
  press('1');
  assert(at()==='relaxed', 'the 1 key did not pick the first term');
  press('3');
  assert(at()==='hard', 'the 3 key did not pick the last term');
  press('ArrowRight');
  assert(at()==='relaxed', 'the arrow keys did not cycle the terms');
  press('ArrowLeft');
  assert(at()==='hard', 'the arrow keys did not cycle back');

  press('Enter');
  assert(A.STATE==='order', 'ENTER with the chooser open clocked the player in instead of folding it shut');
  assert(!A.termsOpen, 'ENTER did not fold the terms chooser shut');

  A.setTermsOpen(true);
  press('Escape');
  assert(A.STATE==='order', 'ESC with the chooser open left the ticket instead of folding it shut');
  assert(!A.termsOpen, 'ESC did not fold the terms chooser shut');

  /* ESC on a shut chooser still walks the chain — the guard is only for the
     open fold */
  press('Escape');
  assert(A.STATE==='splash', 'ESC with the chooser shut did not walk back to the riser');
  press('q');

  /* and with the chooser shut the frame is a splash again */
  A.setOption('difficulty','normal');
  press('w');
  assert(A.STATE==='play', `the clock-in did not start the run (STATE=${A.STATE})`);
  assert(!A.keys['w'], 'the key that dismissed the splash is still held — the player walks before they can react');
  assert(els['hud'].classList.contains('on'), 'the HUD did not come up with the run');
  assert(vis().length===0, `${vis().join()} still up on top of the run`);

  /* repeat is how a held key behaves, and it must not advance twice */
  A.hideAll(); A.STATE='splash'; A.show('splash');
  press('Enter', {repeat:true});
  assert(A.STATE==='splash', 'an auto-repeating ENTER advanced the splash');
  press('Enter');
  press('Enter', {repeat:true});
  assert(A.STATE==='order', 'an auto-repeating ENTER skipped the work order and started the run');
  press('Enter');
  assert(A.STATE==='play', `two ENTER presses on the chain did not reach the run (STATE=${A.STATE})`);

  /* --- M, on the real key handler, in every state ---
     It is the one control with no button, so the key path IS the feature: a
     hotkey that is wired to the wrong state, or that fires on auto-repeat, or
     that also advances the splash, is a hotkey that does not work. */
  const mutedAt = ()=> A.SETTINGS.muted;
  const storeAt = ()=> JSON.parse(global.__store.get(A.SETTINGS_KEY) || '{}');
  const stored = ()=> {
    A.saveSettings();
    const s = storeAt();
    A.loadSettings();
    return s;
  };
  for (const st of ['splash','order','pause','dead','win']){
    A.STATE = st;
    assert(mutedAt()===false || typeof mutedAt()==='boolean',
      `could not read the muted flag in state ${st}`);
    press('m');
    assert(mutedAt()===true, `M did not mute from the ${st} screen`);
    press('m');
    assert(mutedAt()===false, `M did not unmute from the ${st} screen`);
  }
  /* auto-repeat must not toggle twenty times while the key is held */
  A.STATE='play';
  press('m', {repeat:true});
  assert(mutedAt()===false, 'a held M toggled the mute anyway');
  press('m');
  assert(mutedAt()===true, 'M stopped working after an auto-repeat');

  /* and it is the muted one that persists */
  assert(stored().muted===true, 'the mute did not survive a save/load round trip');
  A.setOption('muted', false);
  assert(stored().muted===false, 'unmuting did not persist');

  /* M must NOT be a splash advance: pressing it on the title leaves you on the
     title. A mute key that doubles as "skip intro" is a bug report. */
  A.hideAll(); A.STATE='splash'; A.show('splash');
  press('m');
  assert(A.STATE==='splash', 'M advanced the splash chain');
  A.setOption('muted', false);
  console.log('  ENTER / any key / click advance, ESC steps back, one screen at a time');
  console.log('  M toggles mute from every screen, survives a reload, and never advances the splash');
}

/* ============ TEST 25: the plan behind the title — it is the level you get
   The splash paints a floor plan. The only version of that worth shipping is
   the one the run is actually built from, so the seed contract is the test:
   the painting cannot be re-rolled by anything the player does between seeing
   it and playing it. */
console.log('[25] the splash plan — painted from the seed the run uses');
{
  const html = readHtml();
  const css  = readCss();
  const splashHtml = html.slice(html.indexOf('id="screen-splash"'), html.indexOf('id="screen-order"'));

  /* --- markup: two layers plus the tape pass --- */
  assert(/id="splash-plan"/.test(splashHtml),  'the splash has no plan canvas');
  assert(/id="splash-plan-far"/.test(splashHtml), 'the parallax layer is missing from the splash');
  assert(/splash-bands/.test(splashHtml) && /splash-track/.test(splashHtml),
    'the tape pass over the plan is missing');

  /* --- the roll has to loop: -50% of the canvas must be exactly one period
         of the painting, or there is a seam travelling across the title. --- */
  const roll = css.match(/@keyframes planroll\{[\s\S]*?translateX\(-50%\)/);
  assert(roll, 'the plan does not roll, or does not end at -50% — the period is not the frame width');
  assert(/\.splash-plan\s+canvas\{[^}]*animation:planroll/.test(css), 'the plan layer is not wired to the roll');
  assert(/prefers-reduced-motion[\s\S]*\.splash-plan canvas[^{]*\{[^}]*animation:none/.test(css),
    'the plan still rolls when the system asks for reduced motion');

  /* --- it is faded. A plan at full strength is a tutorial. --- */
  const op = css.match(/\.splash-plan\{[^}]*opacity:([\d.]+)/);
  assert(op && Number(op[1])>0 && Number(op[1])<=0.15,
    `the plan sits at opacity ${op?op[1]:'unset'} — it is supposed to be a hint, not a map`);

  /* --- painting runs headless, and sizes itself so one period is one frame --- */
  buildFloor(0, 4242);
  const cv = els['splash-plan'], far = els['splash-plan-far'];
  const before = calls.list.length;
  A.paintSplashPlan();
  assert(calls.list.length>before, 'paintSplashPlan drew nothing at all');
  assert(cv.width === cv.clientWidth*2,
    `the canvas is ${cv.width}px for a ${cv.clientWidth}px frame — the roll seam is not on a period boundary`);
  assert(far.width === cv.width && far.height === cv.height,
    'the parallax layer is not the same painting at a different speed');

  /* --- the seed contract: nothing between seeing the plan and playing it may
         re-roll the seed. This is the assertion that stops the splash from
         quietly becoming a picture of a building you will never walk. --- */
  const seedAtBoot = A.RUN_SEED;
  document.getElementById('btn-start').click();
  assert(A.RUN_SEED===seedAtBoot, 'clocking in re-rolled the seed — the splash was showing a different level');
  assert(G.seed===A.RUN_SEED, 'the run was not built from the seed the splash was painted with');

  /* ...but a finished run is entitled to a new building. */
  A.rollRunSeed();
  assert(A.RUN_SEED!==seedAtBoot, 'a new run kept the old seed — RUN IT AGAIN is the same building');
  assert(G.seed===A.RUN_SEED, 'the re-rolled seed did not reach the level');
  console.log(`  plan rolls at two speeds, faded to ${op?op[1]:'?'}, loops seamlessly, and matches seed #${(A.RUN_SEED>>>0).toString(16)}`);
}

/* ============ TEST 26: the pause screen IS the work order
   Splash 04 and the pause modal are the same document. That is a design claim,
   so it is asserted as one: same ticket markup, same controls block, and the
   numbers on it are the run's real numbers rather than the static copy the
   splash ships with. A pause screen showing stale text is worse than a plain
   one, because the player trusts it. */
console.log('[26] the pause screen — the work order, with the run written on it');
{
  const html = readHtml();
  const splash = html.slice(html.indexOf('id="screen-splash"'));
  const order  = html.slice(html.indexOf('id="screen-order"'),  html.indexOf('id="screen-pause"'));
  const pause  = html.slice(html.indexOf('id="screen-pause"'),   html.indexOf('id="screen-dead"'));
  assert(pause.length>0, 'the pause screen is missing from index.html');

  /* --- same furniture --- */
  assert(/class="order perf"/.test(pause), 'the pause screen is not the ticket');
  assert(!/class="tape"/.test(pause), 'the pause screen still has its own layout');

  /* --- the settings that remain are pages of the ticket ---
     The modal they used to live in is gone, and the rows it held are inside
     the ticket — that inversion is the assertion: the old test demanded the
     settings link sit BELOW the ticket, and that is exactly what is no
     longer true. */
  assert(!/id="screen-settings"/.test(html),
    'the settings modal is still in index.html — the settings belong on the ticket');
  for (const id of ['set-master','set-hue','set-contrast','btn-settings-reset'])
    assert(new RegExp('id="'+id+'"').test(pause),
      `the pause ticket has no ${id} — a settings row left the ticket`);
  assert(pause.indexOf('id="set-master"') > pause.indexOf('class="order perf"'),
    'the settings rows are outside the ticket instead of inside it');

  /* --- and the difficulty is not one of them. The terms are taken at the
     door: the chooser lives on the work order, the run is built with whatever
     the stamp says at clock-in, and the pause screen prints the terms as a
     fact. A difficulty control on the pause ticket is the mid-run rewrite
     this move exists to kill — applySettings() would move FLOOR_CLOCK and
     REPAIR_TIME under a floor already being played. --- */
  assert(!/id="set-difficulty"/.test(pause),
    'the difficulty chooser is still on the pause ticket — the terms belong at the door');
  assert(!/id="note-difficulty"/.test(pause),
    'the difficulty note is still on the pause ticket');
  assert(/id="set-difficulty"/.test(order)
         && order.indexOf('id="set-difficulty"') > order.indexOf('class="order perf"'),
    'the work order has no terms chooser inside the ticket');
  assert(/id="order-terms"/.test(order) && /id="btn-terms-change"/.test(order),
    'the work order has no SHIFT TERMS stamp or no CHANGE link');
  assert(/id="pause-terms"/.test(pause),
    'the pause ticket does not print the shift terms the run is on');
  
  /* --- and SPLASH 02 is a page of the ticket too --- */
  assert(/data-pause-page="briefing"/.test(pause), 'the pause ticket has no briefing page');
  assert(/data-pause-tab="settings"/.test(pause) && /data-pause-tab="briefing"/.test(pause),
    'the pause ticket has no tabs for its two pages');

  /* --- the same controls, in the same place: the stub, under CONTROLS --- */
  const ctrlBlock = (s)=>{ const m = s.match(/<small>CONTROLS<\/small>([\s\S]*?)<\/div>\s*<\/(?:p|div)>/); return m?m[1]:''; };
  const keysOf = (s)=> [...ctrlBlock(s).matchAll(/<b>([^<]+)<\/b>/g)].map(m=>m[1]);
  const pk = keysOf(pause), ok = keysOf(order);
  assert(ctrlBlock(pause).length>0, 'the pause ticket has no controls block');
  assert(ctrlBlock(order).length>0, 'the splash ticket has no controls block');
  /* The chips are styled with letter-spacing, so the labels are free to be
     written in prose case ("WASD / arrows"); matching is case-insensitive. */
  const has = (list, k)=> list.some(x=>x.toUpperCase().includes(k.toUpperCase()));
  for (const k of ['WASD','ARROWS','SHIFT','R','M','ESC']){
    assert(has(pk, k), `the pause ticket never lists ${k}`);
  }
  /* ENTER is chipped on the splash's list as the confirm key. The pause stub
     lists the keys you use while playing plus ESC, and ENTER is not among
     them — it resumes, as the strip under the ticket says, but a chip list
     and a resume hint are different furniture and the stub only carries the
     first. A key listed as doing something it does not do is worse than a key
     missing from a list. */
  assert(!has(pk, 'ENTER'), 'the pause stub still lists ENTER, which resumes nothing');
  for (const k of ok.filter(x=>!x.toUpperCase().includes('ENTER'))){
    assert(has(pk, k), `the pause ticket dropped ${k}, which the splash lists`);
  }

  /* --- the briefing page reprints the ticket's WORK: scope and notes ---
     It is SPLASH 02's payload without the 88D letterhead and without a second
     copy of the controls list — the stub carries the controls on every page,
     so reprinting them would be a second thing to keep in sync for no reader.
     What the briefing owes the splash is the work itself, so that is what is
     asserted, line by line, rather than by vibe. Scoped to the briefing page
     alone: the slice stops at the stub, or the stub's own chips would answer
     for the page and the check would pass on a page that says nothing. */
  const body = pause.slice(pause.indexOf('data-pause-page="briefing"'),
                           pause.indexOf('class="order-side"'));
  assert(/Scope of work/i.test(body), 'the briefing page has no scope of work');
  assert(body.includes('Locate and repair all leaks on 5 floors'),
    'the briefing page dropped the splash scope sentence');
  const notesOf = (s)=> [...s.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m=>m[1].trim());
  const splashNotes = notesOf(order);
  assert(splashNotes.length>0, 'the splash ticket has no notes to reprint');
  /* The apostrophe may be encoded on one ticket and typed on the other, and
     the numbers on it are wrapped in spans now, so the comparison flattens
     the entities and strips the tags first — checking the words the player
     reads, not the markup that carries them. */
  const flat = (s)=> s.replace(/<[^>]+>/g,'')
                      .replace(/&rsquo;/g,"'").replace(/&lsquo;/g,"'")
                      .replace(/&#39;/g,"'").replace(/&amp;/g,"&");
  for (const n of splashNotes){
    assert(flat(body).includes(flat(n)), `the briefing page dropped a splash note: ${n.slice(0,44)}…`);
  }
  assert(!/controls-big/.test(body),
    'the briefing page reprints the controls list — the stub already carries it');

  /* --- and the numbers are the run's --- */
  buildFloor(2, 9090);
  G.leaksOpen = G.pipes; G.floodCover = 0.31; G.batt = 42; G.stat.noises = 7;
  A.STATE = 'play';
  A.togglePause();
  assert(A.STATE==='pause', 'ESC did not pause');
  /* A pause lands on the settings page — it is the page with something to
     change on it, and the reason most players come back to the ticket. */
  assert(A.pausePage==='settings', 'a pause does not land on the settings page');

  /* ESC walks the pages backwards before it leaves the ticket: briefing back
     to settings, settings back to the run. Driven through the real key
     handler, because a chain asserted only at the API level is a chain that
     disagrees with the key the player actually presses. */
  const keydown = global.window._h.keydown;
  assert(typeof keydown==='function', 'no keydown handler was registered');
  const press = (key, extra={})=> keydown({ key, repeat:false, metaKey:false, ctrlKey:false,
                                            altKey:false, preventDefault(){}, ...extra });
  A.setPausePage('briefing');
  press('Escape');
  assert(A.pausePage==='settings', 'ESC on the briefing page did not return to the settings page');
  assert(A.STATE==='pause', 'ESC on the briefing page resumed the run instead of stepping back');
  press('Escape');
  assert(A.STATE==='play', 'ESC on the settings page did not resume');
  const txt = id=> els[id] ? els[id].innerHTML : '';
  assert(txt('pause-level')==='3/5', `depth reads "${txt('pause-level')}" on level 3`);
  assert(txt('pause-pipes').includes('0/'), `the riser tally reads "${txt('pause-pipes')}"`);
  assert(txt('pause-batt')==='42', `battery reads "${txt('pause-batt')}", expected 42`);
  assert(txt('pause-clock')===A.clockText(G.clock), 'the clock on the ticket is not the clock in state');
  
  /* the life pips are spent ones included — the count the HUD has been showing */
  A.lives = Math.max(1, A.runLives-1);
  A.STATE='play'; A.togglePause();
  assert(/gone/.test(txt('pause-lives')), 'a spent life is not drawn as spent on the ticket');
  A.lives = A.runLives;

  /* once every riser is sealed the LEAKS FIXED tally says so instead of stalling */
  G.leaksOpen = 0;
  A.STATE='play'; A.togglePause();
  assert(txt('pause-pipes')===`${G.pipes}/${G.pipes}`,
    `with every riser sealed the tally reads "${txt('pause-pipes')}"`);

  /* the strip under the ticket promises ENTER resumes as well as ESC. With no
     control focused, ENTER is the modal confirm key — assert the promise,
     through the real key handler, on the page a pause lands on. */
  A.STATE='play'; A.togglePause();
  assert(A.pausePage==='settings', 'a pause does not land on the settings page');
  press('Enter');
  assert(A.STATE==='play', 'ENTER did not resume from the settings page');

  /* --- the run is built with the stamped terms, and the ticket says so -----
     The whole move in a few asserts: the chooser moves the constants the run
     is built with, clocking in reads them, and the work order's stamp names
     the shift. */
  A.setOption('difficulty','hard');
  assert(A.FLOOR_CLOCK===A.DIFFICULTIES.hard.clock,
    'choosing HARD did not move the clock the run is built with');
  document.getElementById('btn-start').click();
  assert(A.runLives===1, 'clocking in on HARD did not set the attempts to 1');
  assert(G.clock===A.DIFFICULTIES.hard.clock, 'the floor was not built with the HARD clock');
  A.togglePause();
  const stamp = els['order-terms'] ? els['order-terms'].textContent : '';
  assert(stamp==='HARD', `the work order stamp reads "${stamp}" on HARD`);
  assert(txt('pause-terms')==='HARD',
    `the pause stub reads "${txt('pause-terms')}" — the run is on terms the ticket never names`);

  /* --- the briefing is written for the terms, not for NORMAL ----------------
     The work order used to say "3 minutes" and "5 seconds" whatever the
     terms, which is a lie on two of the three. Both copies of the document —
     the work order and the pause reprint — follow the choice. */
  const prose = (id)=> (els[id] ? els[id].textContent : '');
  A.setOption('difficulty','hard');
  assert(prose('order-return')==='2 minutes 30 seconds',
    `the work order reads "${prose('order-return')}" on HARD`);
  assert(prose('order-repair')==='4 seconds',
    `the repair note reads "${prose('order-repair')}" on HARD`);
  assert(prose('brief-return')==='2 minutes 30 seconds' && prose('brief-repair')==='4 seconds',
    'the pause reprint of the work order did not follow the terms');
  A.setOption('difficulty','relaxed');
  assert(prose('order-return')==='4 minutes' && prose('order-repair')==='7 seconds',
    `the work order reads "${prose('order-return')}" and "${prose('order-repair')}" on RELAXED`);
  A.setOption('difficulty','normal');
  assert(prose('order-return')==='3 minutes' && prose('order-repair')==='5 seconds',
    'the work order did not return to the NORMAL numbers');

  /* leave the store as the next test expects to find it */
  A.setOption('difficulty','normal');
  document.getElementById('btn-start').click();
  /* --- RESET GAME: two-stage, then a fresh run at the riser ---
     The only control on the ticket that ends a run, so it arms first: the
     first press must change nothing but the label, and the second press is
     the one that moves the player. */
  A.togglePause();
  assert(A.STATE==='pause' && A.pausePage==='settings',
    'the ticket did not open on the settings page for the reset check');
  const resetBtn = els['btn-reset-run'];
  assert(resetBtn, 'the pause settings have no RESET GAME button');
  const seedBefore = A.RUN_SEED;
  resetBtn.click();
  assert(A.STATE==='pause', 'the first press of RESET GAME fired — it must arm first');
  assert(/TAP AGAIN/.test(resetBtn.textContent),
    `the armed label reads "${resetBtn.textContent}"`);
  assert(A.RUN_SEED===seedBefore, 'arming RESET GAME rolled the seed — nothing should have moved');
  assert(A.resetArmed, 'RESET GAME did not report itself armed');

  /* an armed reset does not survive the player's attention moving on */
  A.setPausePage('briefing');
  assert(!A.resetArmed, 'the armed RESET GAME survived a page switch');
  assert(!/TAP AGAIN/.test(resetBtn.textContent),
    'the button still reads armed after the page switch');
  A.setPausePage('settings');

  /* the second press is the one that fires */
  resetBtn.click();
  resetBtn.click();
  assert(A.STATE==='splash', `RESET GAME did not return to the riser (STATE=${A.STATE})`);
  assert(!els['screen-splash'].classList.contains('hidden'),
    'RESET GAME left the riser hidden');
  assert(A.RUN_SEED!==seedBefore, 'RESET GAME kept the seed — the same building is waiting at the door');
  assert(G.floor===0 && G.leaksOpen===G.pipes && G.clock>=A.FLOOR_CLOCK,
    'the floor after RESET GAME is not a fresh floor 0');
  assert(A.lives===A.runLives, 'RESET GAME did not restore the attempts');
  assert(!els['hud'].classList.contains('on'), 'the HUD stayed up over the riser');

  /* and the run it starts from the riser is a full one on the same terms */
  const termsKept = A.SETTINGS.difficulty;
  document.getElementById('btn-start').click();
  assert(A.STATE==='play' && A.lives===A.runLives, 'the run after RESET GAME did not start whole');
  assert(A.SETTINGS.difficulty===termsKept,
    'RESET GAME wiped the stamped terms — preferences are not progress');

  A.STATE='play'; A.hideAll();
  console.log('  pause = the work order, live numbers, settings and briefing as pages of it; terms taken at the door; RESET GAME two-stage');
}

/* ============ TEST 27: the four removed settings are gone, and stay gone
   Settings that only had their widgets deleted would still be readable from a
   stale localStorage blob, still settable through the API, and still rendered
   by a branch nobody remembers writing. All four have to be absent from the
   schema, the store, the markup, and the renderer. */
console.log('[27] the removed settings — frame counter, flicker, tape, shake');
{
  const html = readHtml();
  const css  = readCss();
  const src  = readSrc();
  const GONE = ['showFps','flicker','vhs','shake'];

  for (const k of GONE){
    assert(!(k in A.SETTINGS_SCHEMA), `${k} is still in the schema`);
    assert(!(k in A.SETTINGS_DEFAULTS), `${k} is still a stored default`);
    assert(!(k in A.SETTINGS), `${k} is still live in the store`);
    assert(!html.includes(`data-opt="${k}"`), `index.html still renders a control for ${k}`);
    assert(!new RegExp(`SETTINGS\\.${k}\\b`).test(src), `game.js still reads SETTINGS.${k}`);
  }

  /* no control anywhere: the ids, the labels, the stylesheet rule */
  for (const id of ['set-fps','set-flicker','set-vhs','set-shake']){
    assert(!html.includes(id), `index.html still has #${id}`);
  }
  assert(!/FRAME COUNTER|FLUORESCENT FLICKER|TAPE DEGRADATION|CAMERA SHAKE/.test(html),
    'a removed setting still has a label on screen');
  assert(!/#fps\b/.test(css), 'the frame counter stylesheet rule survived');

  /* and the API refuses to set them, rather than silently growing SETTINGS */
  for (const k of GONE){
    assert(A.settingsValid(k, 1)===false, `${k} still validates`);
    assert(A.setOption(k, 1)===false, `setOption('${k}') was accepted`);
    assert(!(k in A.SETTINGS), `${k} appeared in the store after a set attempt`);
  }

  /* the effects themselves are still drawn — these were look, not preference,
     so removing the settings must not quietly remove the VHS pass */
  assert(/VHS_PASS\s*=\s*0\.7/.test(src), 'the VHS pass lost its constant');
  assert(/FLICKER_DEPTH\s*=\s*0\.65/.test(src), 'the flicker lost its constant');
  assert(/ctx\.fillStyle=scanPat/.test(src), 'the scanline pass is gone — the game no longer looks like a tape');
  assert(/if \(f\.flicker\)/.test(src), 'the tubes no longer stutter');
  render(1000);
  render(2000);
  console.log('  4 settings gone from schema, store, markup, stylesheet, and renderer');
  console.log('  and the effects they controlled are still on, as constants');
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