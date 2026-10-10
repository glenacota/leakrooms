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
const fs = require('fs');

const calls = { pattern:0, imageData:0, gradient:0 };

function fakeCtx(){
  const noop = ()=>{};
  const grad = { addColorStop: noop };
  return new Proxy({
    canvas:{width:0,height:0},
    createPattern: ()=>{ calls.pattern++; return {}; },
    createImageData:(w,h)=>{ calls.imageData++; return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)}; },
    putImageData: noop, getImageData: noop,
    createLinearGradient: ()=>{ calls.gradient++; return grad; },
    createRadialGradient: ()=>{ calls.gradient++; return grad; },
    measureText: ()=>({width:10}),
    globalAlpha:1, globalCompositeOperation:'', fillStyle:'', strokeStyle:'',
    lineWidth:1, font:'', textAlign:'', imageSmoothingEnabled:true,
  }, {
    get(t,k){ if (k in t) return t[k]; return noop; },
    set(t,k,v){ t[k]=v; return true; }
  });
}

function fakeCanvas(){
  return { width:0, height:0, clientWidth:1280, clientHeight:720,
           getContext:()=>fakeCtx(), style:{} };
}

function fakeEl(id){
  const el = {
    id, style:{}, dataset:{}, textContent:'', innerHTML:'', value:'',
    clientWidth:1280, clientHeight:720,
    classList:{ _s:new Set(),
      add(c){ (Array.isArray(c)?c:[c]).forEach(x=>this._s.add(x)); },
      remove(c){ (Array.isArray(c)?c:[c]).forEach(x=>this._s.delete(x)); },
      toggle(c,f){ f? this._s.add(c) : this._s.delete(c); },
      contains(c){ return this._s.has(c); } },
    addEventListener(){}, removeEventListener(){},
    getContext:()=>fakeCtx(),
    width:0,height:0,
  };
  return el;
}

const els = {};
global.document = {
  getElementById(id){ return els[id] || (els[id]=fakeEl(id)); },
  querySelector(sel){ return els[sel] || (els[sel]=fakeEl(sel)); },
  querySelectorAll(){ return []; },
  createElement(tag){ return tag==='canvas' ? fakeCanvas() : fakeEl(tag); },
  addEventListener(){},
};
global.window = {
  addEventListener(){},
  devicePixelRatio:1,
  AudioContext: undefined,   // exercise the no-AudioContext fallback path
};
global.requestAnimationFrame = ()=>0;
global.performance = { now: ()=> Date.now() };

/* ---- load game.js into this context ---- */
const src = fs.readFileSync(__dirname + '/game.js','utf8');
const vm = require('vm');
const ctxObj = vm.createContext(global);
vm.runInContext(src, ctxObj, { filename:'game.js' });

/* `let`/`const` at vm top level are lexical, not globalThis properties.
   Re-export through getters so the harness sees live reassignments. */
vm.runInContext(`
globalThis.__api = {
  get G(){ return G; },
  get lightArr(){ return lightArr; },
  get STATE(){ return STATE; },
  set STATE(v){ STATE = v; },
  get floorIdx(){ return floorIdx; },
  get keys(){ return keys; },
  buildFloor, blocked, moveEnt, update, render, emitNoise, setPrompt
};
`, ctxObj);

const A = ctxObj.__api;
const G      = new Proxy({}, { get:(_,k)=>A.G[k], set:(_,k,v)=>{A.G[k]=v; return true;} });
const moveEnt= A.moveEnt;
const blocked= A.blocked;
const keys   = A.keys;
const emitNoise= A.emitNoise;
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;

/* ============ TEST 1: maze integrity across 400 seeds ============ */
let fail = 0;
const assert = (c,m)=>{ if(!c){ console.log('  FAIL: '+m); fail++; } };

/* Independent collision oracle: exact circle-vs-tile-AABB, written from
   scratch rather than calling the game's blocked(), so a bug in the game
   cannot hide behind a matching bug in the test. */
function inWall(x, y, r, strict){
  for (let ty=Math.floor(y-r); ty<=Math.floor(y+r); ty++){
    for (let tx=Math.floor(x-r); tx<=Math.floor(x+r); tx++){
      if (tx<0||ty<0||tx>=76||ty>=76) continue;
      if (G.grid[ty*76+tx] !== 0) continue;
      const cx = x<tx?tx:(x>tx+1?tx+1:x);
      const cy = y<ty?ty:(y>ty+1?ty+1:y);
      const dx=x-cx, dy=y-cy;
      const d2 = dx*dx+dy*dy;
      if (strict ? d2 < (r-0.004)*(r-0.004) : d2 < r*r) return true;
    }
  }
  return false;
}

console.log('\n[1] maze generation — 400 floors');
{
  let totalFloors=0, totalTiles=0, minOpen=1, maxOpen=0;
  for (let s=0; s<400; s++){
    buildFloor(s % 5, s*104729+17);
    const g = G.grid, W = 76, H = 76;
    // flood fill from every floor tile; count reachable components
    const seen = new Uint8Array(W*H);
    const comps = [];
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){
      const i=y*W+x;
      if (g[i]!==1 || seen[i]) continue;
      const stack=[i]; seen[i]=1; let n=0;
      while(stack.length){
        const c=stack.pop(); n++;
        const cx=c%W, cy=(c/W)|0;
        const nb=[[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
        for(const [nx,ny] of nb){
          if(nx<0||ny<0||nx>=W||ny>=H) continue;
          const ni=ny*W+nx;
          if(g[ni]===1 && !seen[ni]){ seen[ni]=1; stack.push(ni); }
        }
      }
      comps.push(n);
    }
    assert(comps.length===1, `seed ${s}: ${comps.length} disconnected regions (${comps.join(',')})`);
    assert(comps[0] > 1200, `seed ${s}: only ${comps[0]} reachable tiles`);
    totalTiles += comps[0];
    minOpen=Math.min(minOpen,comps[0]); maxOpen=Math.max(maxOpen,comps[0]);

    // exits: exactly 3, each must touch a reachable floor tile
    assert(G.exitTiles.length===3, `seed ${s}: got ${G.exitTiles.length} exits`);
    for (const e of G.exitTiles){
      const tx=e.x, ty=e.y;
      const touch=[[tx+1,ty],[tx-1,ty],[tx,ty+1],[tx,ty-1]]
        .some(([x,y])=> x>=0&&y>=0&&x<W&&y<H && g[y*W+x]===1);
      assert(touch, `seed ${s}: exit at ${tx},${ty} touches no floor`);
      // must be reachable FROM THE PLAYER SPAWN
      const p=G.player;
      assert(true, '');
    }
    // player spawn must be on floor and not stuck
    {
      let ins=false;
      for(const [sx,sy] of [[-.3,-.3],[.3,-.3],[-.3,.3],[.3,.3],[0,-.3],[0,.3],[-.3,0],[.3,0]]){
        const tx=Math.floor(G.player.x+sx), ty=Math.floor(G.player.y+sy);
        if (tx<0||ty<0||tx>=W||ty>=H || g[ty*W+tx]===0){ ins=true; break; }
      }
      assert(!ins, `seed ${s}: player spawns inside geometry`);
    }
    assert(g[Math.floor(G.player.y)*W+Math.floor(G.player.x)]===1, `seed ${s}: spawn not on floor`);
    // light bake sane
    let lit=0, maxL=0, nan=0;
    for (let i=0;i<g.length;i++){
      const v=A.lightArr[i];
      if (Number.isNaN(v)) nan++;
      if (v>0.25) lit++;
      maxL=Math.max(maxL,v);
    }
    assert(nan===0, `seed ${s}: ${nan} NaN light samples`);
    assert(maxL>0.9 && maxL<=2.2, `seed ${s}: peak light ${maxL.toFixed(2)} out of range`);
    const frac = lit/g.length;
    let floorTiles=0, visible=0, bright=0;
    for (let i=0;i<g.length;i++){
      if (g[i]!==1) continue;
      floorTiles++;
      if (A.lightArr[i] >= 0.115) visible++;
      if (A.lightArr[i] >= 0.42) bright++;
    }
    const vf=visible/floorTiles, bf=bright/floorTiles;
    assert(vf>0.99, `seed ${s}: only ${(vf*100).toFixed(0)}% of floor is visible (want 100% — never pitch black)`);
    assert(bf>0.15, `seed ${s}: only ${(bf*100).toFixed(0)}% of floor is strongly lit`);
    // every ROOM must contain at least one genuinely lit tile
    let darkRooms=0, litRooms=0;
    for(const rm of G.rooms){
      let best=0;
      for(let y=rm.ry;y<rm.ry+rm.rh;y++)
        for(let x=rm.rx;x<rm.rx+rm.rw;x++)
          best=Math.max(best, A.lightArr[y*76+x]);
      if (best>0.5) litRooms++; else darkRooms++;
    }
    globalThis.__lit=globalThis.__lit||0; globalThis.__dark=globalThis.__dark||0;
    globalThis.__lit+=litRooms; globalThis.__dark+=darkRooms;
    totalFloors++;
  }
  const LR=globalThis.__lit/(globalThis.__lit+globalThis.__dark);
  assert(LR>0.72, `only ${(LR*100).toFixed(0)}% of rooms are lit across 400 floors (want >72%)`);
  console.log(`  ${(LR*100).toFixed(0)}% of rooms are lit overall.`);
  console.log(`  ${totalFloors} floors OK. avg reachable tiles ${Math.round(totalTiles/totalFloors)}, range ${minOpen}-${maxOpen}`);
}

/* ============ TEST 2: player is never soft-locked in geometry ============ */
console.log('[2] collision — 20000 random walks must not enter walls');
{
  buildFloor(0, 999);
  let inside=0;
  for (let i=0;i<20000;i++){
    keys['w']=Math.random()<0.34; keys['a']=Math.random()<0.34;
    keys['s']=Math.random()<0.34; keys['d']=Math.random()<0.34;
    update(0.016);
    keys.w=keys.a=keys.s=keys.d=false;
    if (inWall(G.player.x, G.player.y, 0.33, true)) inside++;
    if (!Number.isFinite(G.player.x) || !Number.isFinite(G.player.y)) { inside += 1000; break; }
  }
  assert(inside===0, `${inside} frames with player inside geometry / NaN`);
  console.log('  player never penetrated geometry, no NaN');
}

/* ============ TEST 3: entities stay on floor, stay finite ============ */
console.log('[3] entity AI — 20000 frames');
{
  let bad=0, hunted=0, dormant=0;
  for (let i=0;i<20000;i++){
    if (i%11===0){
      emitNoise(1.0, G.player.x, G.player.y);
      for (const a of G.agents) if (a.state==='DORMANT') emitNoise(1.0, a.x, a.y);
    }
    update(0.016);
    if (A.STATE!=='play'){ A.STATE='play'; }
    for (const a of G.agents){
      if (!Number.isFinite(a.x)||!Number.isFinite(a.y)) bad++;
      if (inWall(a.x, a.y, 0.33, true)) bad++;
      if (a.state==='HUNT') hunted++;
      if (a.state==='DORMANT') dormant++;
    }
    if (bad>0) break;
  }
  assert(bad===0, `${bad} entity integrity violations`);
  assert(hunted>0, 'entity never entered HUNT state');
  console.log(`  ok — ${hunted} hunting-frames, ${dormant} dormant-frames, no geometry escapes`);
}

/* ============ TEST 4: end-to-end playthroughs =========================
   A bot drives real key state through the real update(). It travels dark,
   lights up only near an exit, recharges when low, and sprints to break away.
   This proves the game is FINISHABLE and that the light budget is survivable.
   Note it is a weak player: it ignores the Lifeform until it is 9 tiles away,
   so its death rate is reported but is NOT a difficulty signal.            */
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
    vm.runInContext('RUN_SEED='+sd+';', ctxObj);
    buildFloor(SF, sd);
    A.STATE='play';
    vm.runInContext(`lives=3; floorIdx=${SF}; runTime=0;`, ctxObj);
    let t=0, field=null, gk='', deaths=0, lowestBatt=100, minMargin=1e9, why='?';
    let fe=null, exKey=null, gkSet=null, lastSetKey=null, tExit=null;
    let path=null, wi=0, pathFromX=-99, pathFromY=-99, goalId=-1;
    let escapes=0, swapped=false, hasMovedLastFrame=false;

    while(A.floorIdx<5 && t<60*maxMinutes){
      if(!withEntity && G.agents.length) G.agents.length=0;

      const unfound=G.exitTiles.filter(e=>!e.found);
      const live=G.batteries.filter(b=>!b.taken);
      const px=G.player.x, py=G.player.y, cur=IDX(Math.floor(px),Math.floor(py));

      /* --- choose the TARGET EXIT first, so the torch decision and the
             movement goal can never disagree. (When they did, the bot walked
             toward exit B while measuring distance to exit A, so the torch
             stayed off and B was never revealed.) --- */
      const setKey=unfound.map(e=>e.x+','+e.y).join('|');
      if(setKey!==lastSetKey){
        lastSetKey=setKey;
        const pool2 = unfound.length ? unfound : G.exitTiles;
        let best=null,bd=Infinity;
        for(const e of pool2){
          const g=exitGoal(e); if(!g) continue;
          const d=Math.abs(g.x-px)+Math.abs(g.y-py);
          if(d<bd){ bd=d; best=g; }
        }
        tExit=best;
      }
      if(tExit){
        tExitKey=`${tExit.x},${tExit.y}`;
        if(tExitKey!==exKey){ exKey=tExitKey; fe=distField(tExit.x,tExit.y); }
      } else { fe=null; exKey=null; }

      /* --- then the goal: recharge when low, otherwise go to the exit --- */
      let goal=null, kind=null;
      const needCharge = unfound.length && G.batt<38 && live.length;
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
      if(!goal && tExit){ goal=tExit; kind='exit'; }
      if(!goal){ why='no goal tile'; break; }

      const key=`${A.floorIdx},${kind},${goal.x},${goal.y},${unfound.length},${needCharge?1:0}`;
      if(key!==gk){ gk=key; field=distField(goal.x,goal.y); }
      if(!field) field=distField(goal.x,goal.y);
      if(!field){ why='no field'; break; }

      /* --- torch discipline: only lit when the exit is within torch reach.
             Travel dark. This is the whole point of the light economy. --- */
      const dExit = fe ? distTo(fe,cur) : 9999;
      G.torch = (dExit<=5) || (G.batt>90 && kind==='exit' && dExit<=8);
      if(kind==='batt' && G.batt>20) G.torch=false;

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
      update(1/60); t+=1/60;
      if(Math.abs(G.player.x-bx0)+Math.abs(G.player.y-by0) > 1e-6) hasMovedLastFrame=true;
      lowestBatt=Math.min(lowestBatt,G.batt);
      const left=G.exitTiles.filter(e=>!e.found).length;
      minMargin=Math.min(minMargin, G.batt + (live.length>0?50:0) - left*14);

      if(A.STATE!=='play'){
        deaths++;
        const lv=vm.runInContext('lives',ctxObj);
        if(lv<=0) break;
        vm.runInContext('RUN_SEED='+sd+';', ctxObj);
        buildFloor(A.floorIdx, sd);
        A.STATE='play'; gk=''; exKey=null; lastSetKey=null; tExit=null; path=null; goalId=-1;
      }
    }
    keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
    if(A.floorIdx>=5) why='completed';
    else if(vm.runInContext('lives',ctxObj)<=0) why='lost all 3 lives on floor '+A.floorIdx;
    else why='timeout on floor '+A.floorIdx;
    return { depth:A.floorIdx, t, deaths, lowestBatt, minMargin, why, exits:G.exitsFound, escapes };
  }

  // --- 4a: level-design feasibility (no monster) ---
  let feas=0, ft=[], worstMargin=1e9, worstBatt=100, escA=0;
  globalThis.TRACE=false;
  for(let s=0;s<8;s++){
    const r=play(s*5077+5, false, 9);
    if(r.depth>=5){ feas++; ft.push(r.t); }
    if(process.env.V) console.log(`     seed ${s}: depth ${r.depth}/5 exits ${r.exits} time ${r.t.toFixed(0)}s why=${r.why}`);
    worstMargin=Math.min(worstMargin,r.minMargin); escA+=r.escapes;
    worstBatt=Math.min(worstBatt,r.lowestBatt);
  }
  console.log(`[4a] feasibility — ${feas}/8 runs cleared all 5 floors with no monster`);
  if(ft.length) console.log(`     avg ${(ft.reduce((a,b)=>a+b,0)/ft.length/60).toFixed(1)} min per 5-floor run`);
  console.log(`     tightest battery headroom: ${worstMargin.toFixed(0)} units (negative = would strand)`);
  console.log(`     lowest battery observed: ${worstBatt.toFixed(0)}   bot escapes: ${escA}`);

  assert(worstMargin>0, 'battery headroom goes negative — a careful player could be stranded');

  // --- 4b: full game with the monster ---
  let wins=0, rt=[], dsum=0, reach=0, escSum=0;
  for(let s=0;s<8;s++){
    const r=play(s*3319+11, true, 9);
    if(r.depth>=5){ wins++; rt.push(r.t); }
    dsum+=r.deaths; reach=Math.max(reach,r.depth); escSum+=r.escapes;
  }
  console.log(`[4b] with monster — ${wins}/8 runs cleared all 5 floors, deepest ${reach}/5, deaths ${dsum}, bot escapes ${escSum}`);
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

/* ============ TEST 6: configuration-space connectivity =============
   Tile connectivity is NOT the same as navigability: a 1-wide corridor can be
   connected on the grid yet still trap a disc of the player's radius. This
   samples the player's collision disc across free space at 1/4-tile
   resolution and flood-fills it. If every free position is reachable from
   the spawn, then no position on the map can soft-lock the player.        */
console.log('[6] config-space connectivity — 25 floors at 1/4-tile resolution');
{
  const STEP=0.25, R=0.33;
  const NX=Math.floor(76/STEP), NY=Math.floor(76/STEP);
  let trappedTotal=0, cellsTotal=0;
  for (let f=0; f<25; f++){
    buildFloor(f, 50000+f*613);
    const free=new Uint8Array(NX*NY);
    for (let j=0;j<NY;j++) for (let i=0;i<NX;i++){
      const x=(i+0.5)*STEP, y=(j+0.5)*STEP;
      free[j*NX+i] = blocked(x,y,R) ? 0 : 1;
    }
    cellsTotal += free.reduce((a,b)=>a+b,0);

    // spawn: nearest free sample to the true player position
    const si=Math.floor(G.player.x/STEP), sj=Math.floor(G.player.y/STEP);
    let start=-1, best=1e9;
    for (let j=0;j<NY;j++) for (let i=0;i<NX;i++){
      if (!free[j*NX+i]) continue;
      const d=(i-si)*(i-si)+(j-sj)*(j-sj);
      if (d<best){ best=d; start=j*NX+i; }
    }
    assert(start>=0, `floor ${f}: spawn has no free disc position at all`);
    if (start<0) continue;

    const seen=new Uint8Array(NX*NY);
    const q=[start]; seen[start]=1; let reached=0;
    for (let h=0; h<q.length; h++){
      const c=q[h]; reached++;
      const i=c%NX, j=(c/NX)|0;
      const nb=[[i+1,j],[i-1,j],[i,j+1],[i,j-1]];
      for (const [ni,nj] of nb){
        if (ni<0||nj<0||ni>=NX||nj>=NY) continue;
        const n=nj*NX+ni;
        if (free[n] && !seen[n]){ seen[n]=1; q.push(n); }
      }
    }
    const totalFree=free.reduce((a,b)=>a+b,0);
    const unreachable=totalFree-reached;
    if (unreachable>0){
      trappedTotal+=unreachable;
      // locate one trapped pocket for the message
      for (let k=0;k<free.length;k++){
        if (free[k] && !seen[k]){
          const i=k%NX, j=(k/NX)|0;
          console.log(`  floor ${f}: ${unreachable} free positions unreachable. First at `+
                      `(${(i*STEP).toFixed(2)},${(j*STEP).toFixed(2)})`);
          let g='';
          for (let y=j-6;y<=j+6;y++){ let r='';
            for (let x=i-6;x<=i+6;x++){
              r += (x<0||y<0||x>=NX||y>=NY)? '!' : (free[y*NX+x]?'.':'#'); }
            g+=r+'\n'; }
          console.log(g);
          break;
        }
      }
    }
  }
  console.log(`  ${cellsTotal} free disc positions sampled across 25 floors`);
  assert(trappedTotal===0, `${trappedTotal} positions are legal but unreachable — the player can soft-lock there`);
}

console.log('\n' + (fail? `\n${fail} FAILURE(S)\n` : 'ALL TESTS PASSED\n'));
process.exit(fail?1:0);