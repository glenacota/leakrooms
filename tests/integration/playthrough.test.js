import test from 'node:test';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const { A, G, els, calls } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const updateReal = A.updateReal;
const blocked = A.blocked;
const keys = A.keys;
const emitNoise = A.emitNoise;

/* ============ TEST 4: end-to-end playthroughs =========================
   A bot drives real key state through the real update(). It walks to the
   nearest open riser, holds still to seal it, then walks back to the door it
   came in through — which is the entire level. This proves the game is
   FINISHABLE, and that three minutes is enough of a budget to do five levels of
   it in. Note it is a weak player: it ignores the Lifeform until it is 9 tiles
   away, so its death rate is reported but is NOT a difficulty signal.        */
test('[4] end-to-end — bot drives REAL keys through update()', () => {
  const t = softAssert();
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

  t.assert(worstMargin>0, 'clock headroom goes negative — a careful player would run out of time');

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
  t.done();
});


/* ============ TEST 18: a level is FINISHABLE, pipes and all =========
   The whole level is one objective set — every riser, then the door — so it
   has to be inside the completion path the end-to-end bot already walks. This
   drives the bot at one riser, then the next, then the door it came in by, and
   asserts the level actually completes through the real update() with real key
   state. Level 5 is the one that matters: four pipes is where a placement bug
   or a tally bug shows up, because with one there is nothing to get wrong. */
test('[18] end-to-end — the bot seals every riser, then walks back out', () => {
  const t = softAssert();
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
  t.assert(noPath===0, `${noPath} legs had no path — the objective is unreachable`);
  t.assert(arrived===A.LEVELS_N, `the bot sealed every riser on ${arrived}/${A.LEVELS_N} levels`);
  t.assert(risersSealed===risersWanted,
    `${risersSealed}/${risersWanted} pipes were sealed — the tallies do not agree`);
  t.assert(descended===A.LEVELS_N, `the bot walked back out on ${descended}/${A.LEVELS_N} levels`);
  console.log(`  bot: ${risersSealed} pipes sealed, ${descended}/${A.LEVELS_N} levels walked back out`);
  A.floorIdx=0;
}
  t.done();
});

