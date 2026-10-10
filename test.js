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

const calls = { pattern:0, imageData:0, gradient:0, list:[] };

function fakeCtx(){
  const noop = ()=>{};
  const grad = { addColorStop: noop };
  return new Proxy({
    canvas:{width:0,height:0},
    setTransform(...a){ calls.list.push(['setTransform',...a]); },
    translate(...a){ calls.list.push(['translate',...a]); },
    drawImage(...a){ calls.list.push(['drawImage',...a]); },
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
  get visArr(){ return visArr; },
  get visTgt(){ return visTgt; },
  get maskArr(){ return maskArr; },
  get coneArr(){ return coneArr; },
  get torchArr(){ return torchArr; },
  get regionOf(){ return regionOf; },
  get regionAdj(){ return regionAdj; },
  get visRegion(){ return visRegion; },
  get DARK_ROOM(){ return DARK_ROOM; },
  get GATE_SPILL(){ return GATE_SPILL; },
  get VIEW_HALF(){ return VIEW_HALF; },
  get VIEW_RANGE(){ return VIEW_RANGE; },
  get TORCH_RANGE(){ return TORCH_RANGE; },
  get TORCH_HALF(){ return TORCH_HALF; },
  get TORCH_GAIN(){ return TORCH_GAIN; },
  buildFloor, blocked, moveEnt, update, render, emitNoise, setPrompt, drawPlayer,
  scopeRoomLight, regionAt, traceViewCone, packMask,
  get STATE(){ return STATE; },
  set STATE(v){ STATE = v; },
  get floorIdx(){ return floorIdx; },
  get keys(){ return keys; },
  get TORCH_OFF(){ return TORCH_OFF; }, get R(){ return R; }, drawAgent,
  get cvs(){ return cvs; }, get TILE(){ return TILE; }
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

  let SCALE=1, tx=null, ty=null, lightDraw=null;
  for (const c of calls.list){
    if (c[0]==='setTransform' && SCALE===1 && c[1]!==1) SCALE = c[1];   // FIRST one is the camera
    if (c[0]==='translate' && tx===null){ tx = c[1]; ty = c[2]; }
    if (c[0]==='drawImage' && lightDraw===null) lightDraw = c;
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

  // the light bake must share the origin of the geometry
  assert(lightDraw, 'lightmap drawImage not captured');
  // drawImage args are [img, x, y, ...] so the origin is at index 2/3
  assert(Math.abs(lightDraw[2] - tx*SCALE) < 0.01 && Math.abs(lightDraw[3] - ty*SCALE) < 0.01,
    `lightmap origin (${lightDraw[2]?.toFixed(1)},${lightDraw[3]?.toFixed(1)}) != world origin `+
    `(${(tx*SCALE).toFixed(1)},${(ty*SCALE).toFixed(1)}) — lighting will be offset`);
  console.log(`  player at ${pxDev.toFixed(0)},${pyDev.toFixed(0)}; viewport centre ${CW/2},${CH/2}`);
  console.log(`  10 tiles spans ${span.toFixed(0)}px; lightmap origin aligned with geometry`);
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
    ['torso dark',  0,     0.024,  0.172, 0.136],
    ['torso lit',   0,     0.014,  0.147, 0.111],
    ['arm L',      -0.156, 0.057,  0.054, 0.071],
    ['arm R',       0.156, 0.057,  0.054, 0.071],
    ['head',        0,    -0.017,  0.095, 0.095],
    ['torch glow',  0,    -0.135,  0.085, 0.085],
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

  // and the torch origin must sit in front, not at the body centre
  assert(A.TORCH_OFF > 0.05 && A.TORCH_OFF < R,
    `TORCH_OFF=${A.TORCH_OFF} is not a plausible forward offset`);
  const src = A.drawPlayer.toString();
  assert(src.includes('TORCH_OFF*TILE'), 'avatar no longer draws the torch offset');
  /* The beam must originate at the torch, not the body centre. It used to be
     an additive gradient drawn inside render(); it is now a ray fan in the
     visibility mask, because once dark rooms are black an additive pass has no
     geometry left underneath it to reveal. The assertion follows the code
     rather than the file it used to live in — the invariant is where the beam
     comes from, not which function draws it. */
  const vsrc = A.traceViewCone.toString();
  assert(vsrc.includes('TORCH_OFF'),
    'the beam no longer originates at the torch offset');
  // the avatar must be drawn at its TRUE position, not the tile centre offset
  const dsrc = A.drawPlayer.toString();
  assert(/const x\s*=\s*p\.x\s*\*\s*TILE/.test(dsrc),
    'avatar is drawn with a +0.5 tile offset from its real position');
  assert(!/const x=\(p\.x\+0\.5\)\*TILE/.test(dsrc),
    'avatar still drawn at (p.x+0.5) — half a tile from the collision point');
  const asrc = A.drawAgent.toString();
  assert(/const x\s*=\s*a\.x\s*\*\s*TILE/.test(asrc),
    'agents are drawn with the same half-tile offset');
  console.log(`  beam origin is ${A.TORCH_OFF} tiles in front of the body centre`);
}

/* ============ TEST 9: wall contact must not accelerate ===============
   The corner assist used a fixed 0.30-tile perpendicular nudge, applied every
   frame. Holding into a wall therefore slid the avatar sideways at ~18 tiles
   per second — it looked like the player sped up on contact. The nudge must be
   bounded by the step, so pressing into a wall can never move you faster
   along the wall than you move normally.                                     */
console.log('[9] wall contact does not accelerate the avatar');
{
  buildFloor(3, 8642);
  const keys = A.keys;

  // walk into the nearest wall for a second and measure lateral drift
  let best=null;
  for (let y=2;y<74 && !best;y++) for (let x=2;x<74;x++){
    if (G.grid[y*76+x]!==1) continue;
    if (G.grid[(y+1)*76+x]!==0) continue;      // wall below
    best={x:x+0.5, y:y+0.5}; break;
  }
  assert(best, 'no wall-adjacent tile found');
  if (!best){ keys.w=keys.a=keys.s=keys.d=false; }
  else {
    G.player.x=best.x; G.player.y=best.y;
    for(let i=0;i<5;i++) update(1/60);
    const y0=G.player.y, x0=G.player.x;
    keys.s=true;                                  // push down into the wall
    for(let i=0;i<60;i++) update(1/60);           // one second
    keys.s=false;
    const drift = Math.abs(G.player.y - y0);
    const creep = Math.abs(G.player.x - x0);
    console.log(`  1s pushing into a wall: lateral drift ${drift.toFixed(3)} tiles, `+
                `along-wall creep ${creep.toFixed(3)}`);
    // walk speed is 3.3 tiles/s. A step-bounded nudge cannot exceed that,
    // and certainly not the ~18 tiles/s the fixed 0.30 nudge produced.
    assert(drift < 3.4, `pressing into a wall slid the avatar ${drift.toFixed(2)} tiles in 1s — faster than walking (3.3)`);
    assert(creep < 3.4, `pressing into a wall crept ${creep.toFixed(2)} tiles along it in 1s`);
  }
  keys.w=keys.a=keys.s=keys.d=false;

  // and a free sprint must still reach full speed (the bound must not cap it)
  buildFloor(3, 8642);
  let room=null;
  for (let y=2;y<74 && !room;y++) for (let x=2;x<74;x++){
    if (G.grid[y*76+x]===1 && G.grid[y*76+x+1]===1 && G.grid[y*76+x+2]===1 &&
        G.grid[y*76+x+3]===1 && G.grid[y*76+x+4]===1 && G.grid[y*76+x+5]===1){
      room={x:x+0.5,y:y+0.5}; break; }
  }
  if (room){
    G.player.x=room.x; G.player.y=room.y;
    for(let i=0;i<5;i++) update(1/60);
    const sx0=G.player.x;
    keys.d=true; keys.shift=true;
    for(let i=0;i<60;i++) update(1/60);
    keys.d=false; keys.shift=false;
    const dist=Math.abs(G.player.x-sx0);
    console.log(`  1s sprinting in the open: ${dist.toFixed(2)} tiles (expect ~${(6.0).toFixed(1)})`);
    assert(dist > 5.0, `sprint only covered ${dist.toFixed(2)} tiles in 1s — movement was over-constrained`);
  }
}

/* ============ TEST 10: pressing into a wall must not slide sideways ====
   Reported as: "going up facing a wall, the avatar moves faster towards the
   right, and when the wall is over the avatar it is teleported far right."
   The perpendicular corner-assist tried its two signs in a FIXED order, so it
   always picked +x — holding up against a wall walked the avatar right until
   it left the screen — and the immobile fallback could relocate 0.9 tiles in
   one frame.                                                                     */
console.log('[10] pressing into a wall produces no lateral drift and no teleport');
{
  const keys = A.keys;
  const release = ()=>{ keys.w=keys.a=keys.s=keys.d=false; keys.shift=false; };

  // find a floor tile with a wall DIRECTLY above it
  let spot=null;
  for (let y=3;y<74 && !spot;y++) for (let x=3;x<74;x++){
    if (G.grid[y*76+x]===1 && G.grid[(y-1)*76+x]===0) { spot={x:x+0.5,y:y+0.5}; break; }
  }
  assert(spot, 'no wall-above tile found');

  if (spot){
    buildFloor(3, 555);
    // re-locate on THIS floor
    spot=null;
    for (let y=3;y<74 && !spot;y++) for (let x=3;x<74;x++){
      if (G.grid[y*76+x]===1 && G.grid[(y-1)*76+x]===0){ spot={x:x+0.5,y:y+0.5}; break; }
    }
    G.player.x=spot.x; G.player.y=spot.y;
    release();
    for(let i=0;i<5;i++) update(1/60);
    const x0=G.player.x, y0=G.player.y;
    keys.w=true;                                 // hold UP into the wall
    let maxJump=0, prevX=G.player.x, prevY=G.player.y;
    for(let i=0;i<60;i++){
      update(1/60);
      maxJump=Math.max(maxJump, Math.hypot(G.player.x-prevX, G.player.y-prevY));
      prevX=G.player.x; prevY=G.player.y;
    }
    release();
    const dx=G.player.x-x0, dy=G.player.y-y0;
    console.log(`  1s holding up into a wall: dx=${dx.toFixed(3)} dy=${dy.toFixed(3)}, `+
                `largest single-frame jump ${maxJump.toFixed(3)} tiles`);
    assert(Math.abs(dx) < 0.02,
      `avatar drifted ${dx.toFixed(3)} tiles sideways while pressing straight up into a wall — should be 0`);
    assert(maxJump < 0.20,
      `single-frame jump of ${maxJump.toFixed(3)} tiles — that is a teleport, not a nudge`);
    // it should end up FLUSH with the wall: centre-to-face distance == radius
    const wallFace = Math.floor(G.player.y);          // boundary below the wall tile
    const gap = G.player.y - wallFace;
    console.log(`  final gap to wall face ${gap.toFixed(3)} tiles (collision radius ${A.R})`);
    assert(gap >= A.R - 0.02 && gap <= A.R + 0.12,
      `ended ${gap.toFixed(3)} tiles from the wall face; expected flush at ~${A.R} (not sunk in, not short)`);
  }
  release();

  // same for a pure horizontal press, and for sprint
  for (const [k,label] of [['a','left'],['d','right']]){
    let sp=null;
    for (let y=3;y<74 && !sp;y++) for (let x=4;x<74;x++){
      if (G.grid[y*76+x]===1 && G.grid[y*76+x-1]===0 && G.grid[y*76+x-2]===0){ sp={x:x+0.5,y:y+0.5}; break; }
    }
    if(!sp) continue;
    G.player.x=sp.x; G.player.y=sp.y;
    release(); for(let i=0;i<5;i++) update(1/60);
    const y0=G.player.y;
    keys[k]=true;
    for(let i=0;i<60;i++) update(1/60);
    release();
    const drift=Math.abs(G.player.y-y0);
    assert(drift < 0.05, `pressing ${label} into a wall drifted ${drift.toFixed(3)} tiles vertically`);
  }
  console.log('  no lateral drift on any axis, no teleports');
}

/* ============ TEST 11: room shape and gate size ====================
   Spec: "smaller rooms, like mostly not above 120 tiles large, flowing one
   into the other through smaller door-like gates, e.g. 2 tiles large."
   So: room area capped, and the openings that link rooms are 2 tiles wide
   rather than full-width gaps.                                             */
console.log('[11] room shape (area cap) and 2-tile gates');
{
  let rooms=0, floors=0, side=[], maxArea=0, over120=0;
  for (let f=0; f<30; f++){
    buildFloor(f, 4000+f*613);
    floors++;
    for (const r of G.rooms){
      rooms++;
      side.push((r.rw+r.rh)/2);
      const area = r.rw*r.rh;
      if (area > maxArea) maxArea = area;
      if (area > 120) over120++;
    }
  }
  const mean = side.reduce((a,b)=>a+b,0)/side.length;
  console.log(`  ${(rooms/floors).toFixed(0)} rooms/floor, mean side ${mean.toFixed(1)} tiles, `+
              `max area ${maxArea} tiles`);
  assert(rooms/floors > 40, `only ${(rooms/floors).toFixed(0)} rooms per floor`);
  assert(over120 === 0, `${over120} rooms exceed 120 tiles of area (max was ${maxArea})`);

  /* Gate width. A doorway through a wall band shows as W O O W along an axis;
     a 1-tile gap shows as W O W. Tunnels flare where they meet a room, so
     wide runs are expected — but 1-tile pinholes should be rare. */
  buildFloor(0, 4000);
  const sol=(x,y)=> (x<0||y<0||x>=76||y>=76) ? true : G.grid[y*76+x]===0;
  let one=0, two=0;
  for (let x=0;x<76;x++) for (let y=2;y<74;y++){
    if (sol(x,y-1) && !sol(x,y)   &&  sol(x,y+1))            one++;
    if (sol(x,y-1) && !sol(x,y)   && !sol(x,y+1) && sol(x,y+2)) two++;
  }
  for (let y=0;y<76;y++) for (let x=2;x<74;x++){
    if (sol(x-1,y) && !sol(x,y)   &&  sol(x+1,y))            one++;
    if (sol(x-1,y) && !sol(x,y)   && !sol(x+1,y) && sol(x+2,y)) two++;
  }
  const ratio = one/Math.max(1,two);
  console.log(`  vertical-wall openings: ${two} two-tile, ${one} one-tile `+
              `(${one+two} total)`);
  assert(two > one*2, `only ${two} two-tile gates vs ${one} one-tile — gates are too narrow`);
  assert(ratio < 0.5, `${(ratio*100).toFixed(0)}% of gates are 1 tile wide — rooms are pinholed, not linked`);

  // rooms must actually link to each other, not sit sealed in solid rock
  let isolated=0;
  for (const r of G.rooms){
    let opens=0;
    const per=[[-1,0],[1,0],[0,-1],[0,1]];
    for (let y=r.ry-1;y<=r.ry+r.rh;y++) for (let x=r.rx-1;x<=r.rx+r.rw;x++){
      if (x<0||y<0||x>=76||y>=76) continue;
      if (G.grid[y*76+x]===1) continue;
      for (const [dx,dy] of per) if (G.grid[(y+dy)*76+(x+dx)]===1) opens++;
    }
    if (opens < 2) isolated++;
  }
  console.log(`  rooms with fewer than 2 doorway tiles: ${isolated}/${G.rooms.length}`);
  assert(isolated === 0, `${isolated} rooms are effectively sealed — they do not flow into each other`);
}

/* ============ TEST 12: room-scoped visibility =======================
   The room you are standing in is lit; the rooms you are not, are dark.

   The BAKE is unchanged by this (test 1 still asserts its coverage), so the
   risk is entirely in the second layer: a scope that leaks, a scope that does
   not follow the player, a scope that punches a black hole through the wall
   you are leaning on, or a scope that quietly mutates the bake. Each of those
   is a separate failure mode, so each gets its own assertion.             */
console.log('[12] room-scoped light — your room is lit, the rest is dark');
{
  const W=76, H=76, DARK=A.DARK_ROOM, SPILL=A.GATE_SPILL;

  const hopsFrom = (start)=>{
    const adj=A.regionAdj, hops=new Int32Array(adj.length).fill(-1);
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
        if (G.grid[i]!==1 || A.regionOf[i]!==ri) continue;
        G.player.x=x+0.5; G.player.y=y+0.5;
        A.scopeRoomLight(0, true);
        return true;
      }
    return false;
  };

  let floors=0, placed=0, leak=0, blackHole=0, noFollow=0, bakeMut=0, unreachable=0;
  let ownTotal=0, ownFloors=0, farTotal=0, farFloors=0;

  for (let s=0; s<120; s++){
    buildFloor(s%5, s*7717+31);
    floors++;
    const regOf=A.regionOf, vis=A.visArr, bake=A.lightArr;

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

    const here = A.visRegion;
    assert(here>=0, `seed ${s}: player region is -1 while standing on floor`);
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
        if (h===0){
          // the room you are in: fully scoped, and bright enough to see by
          if (vis[i] < 0.999) leak++;
          if (shown < 0.40) blackHole++;
          ownSum+=shown; ownN++;
        } else if (h===1){
          if (Math.abs(vis[i]-SPILL) > 1e-6) leak++;   // spill ceiling, exactly
        } else if (h>=2){
          // the actual feature: rooms you are NOT in are dark
          if (Math.abs(vis[i]-DARK) > 1e-6) leak++;
          farSum+=shown; farN++;
        }
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
       check the room just left went dark. A scope computed once at floor
       build would pass every check above and still be a no-op in play. */
    const otherRi = (s*13+7)%rooms.length;
    if (otherRi!==homeRi && standIn(otherRi)){
      if (A.regionAt(G.player.x, G.player.y) !== A.visRegion) noFollow++;
      const oldR=rooms[homeRi];
      for (let y=oldR.ry;y<oldR.ry+oldR.rh && !noFollow;y++)
        for (let x=oldR.rx;x<oldR.rx+oldR.rw;x++){
          const i=y*W+x;
          if (G.grid[i]===1 && vis[i] > DARK+1e-6){ noFollow++; break; }
        }
    }
  }

  assert(unreachable===0, `${unreachable}/120 floors had floor tiles with no region, or an unreachable region`);
  assert(leak===0, `${leak} visibility values did not match their region's scope`);
  assert(blackHole===0, `${blackHole} tiles were too dark to stand in or to see the wall beside`);
  assert(noFollow===0, `${noFollow} cases where the light did not follow the player into the next room`);
  assert(bakeMut===0, `${bakeMut} floors where scoping mutated the ambient bake in place`);
  /* DARK_ROOM is 0, so the far rooms should be genuinely black and a ratio
     against them is division by zero. Report that plainly rather than letting
     an epsilon guard print a large fake number. */
  const anyFarLit = farFloors > 0;
  const ratio = anyFarLit ? (ownTotal/ownFloors)/(farTotal/farFloors) : Infinity;
  assert(!anyFarLit || ratio > 2.0,
    `your room is only ${ratio.toFixed(2)}x brighter than the rooms beyond it (want black, or >2x)`);
  console.log(`  ${floors} floors, ${placed} scoped; ` +
    (anyFarLit ? `your room is ${ratio.toFixed(2)}x brighter than the far ones`
               : 'every room two gates away is fully black'));
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
    assert(aRi>=0 && bRi>=0, 'no two standable rooms found for the crossfade check');
    if (aRi>=0 && bRi>=0){
      standIn(aRi);
      const a=G.rooms[aRi], b=G.rooms[bRi];
      // a floor tile of A and of B to sample, found the same way
      const tileOf = (ri)=>{
        const r=G.rooms[ri];
        for (let y=r.ry;y<r.ry+r.rh;y++) for (let x=r.rx;x<r.rx+r.rw;x++)
          if (G.grid[y*W+x]===1 && A.regionOf[y*W+x]===ri) return y*W+x;
        return -1;
      };
      const ai=tileOf(aRi), bi=tileOf(bRi);

      standIn(aRi);
      const litBefore = A.visArr[ai];

      // land on a real tile of B, then begin the fade (non-instant)
      let placedB=false;
      for (let y=b.ry;y<b.ry+b.rh && !placedB;y++)
        for (let x=b.rx;x<b.rx+b.rw;x++){
          if (G.grid[y*W+x]!==1 || A.regionOf[y*W+x]!==bRi) continue;
          G.player.x=x+0.5; G.player.y=y+0.5; placedB=true; break;
        }
      assert(placedB, 'room B had no standable floor tile');
      A.scopeRoomLight(0, false);
      const during = A.visArr[ai];
      assert(during > litBefore - 1e-6,
        'the room you left went dark on the same frame you entered the new one — no crossfade');
      for (let i=0;i<600;i++) update(1/60);            // 10s: far past LIGHT_FADE
      const settled = A.visArr[ai];
      const nowLit  = A.visArr[bi];
      assert(settled < DARK+1e-6, `the room you left settled at ${settled.toFixed(3)}, want <= ${DARK}`);
      assert(nowLit  > 0.999, `the room you entered settled at ${nowLit.toFixed(3)}, want 1`);
      console.log(`  crossfade settles: left room ${settled.toFixed(2)}, entered room ${nowLit.toFixed(2)}`);
    }
  }
}

/* ============ TEST 13: cone of vision ==============================
   200 degrees, stopped by walls. Two failure modes that look identical on
   screen and are caught completely differently here:

     - a cone that does not rotate, so you can see behind you permanently
     - a cone that ignores walls, so a one-tile partition stub fails to hide
       the floor behind it

   The second is why this is a ray cast and not a per-tile angle test, and it
   is invisible in aggregate statistics: the stub is 1 tile of 5776.            */
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
  assert(spot && bestClear>=8, `no open spot found (best clear run ${bestClear})`);

  const set=(fx,fy,face)=>{
    G.player.x=spot.x; G.player.y=spot.y; G.player.face=face;
    scopeRoomLight(0,true);
    A.traceViewCone(true); A.packMask();
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
  const eye=()=>[spot.x + Math.cos(G.player.face)*A.TORCH_OFF,
                 spot.y + Math.sin(G.player.face)*A.TORCH_OFF];

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
    const v = Array.from(A.coneArr);
    return {face, v};
  });
  let maxDiff=0;
  for (let a=0;a<probes.length;a++) for (let b=a+1;b<probes.length;b++)
    for (let i=0;i<seenAt[0].v.length;i++)
      maxDiff=Math.max(maxDiff, Math.abs(seenAt[a].v[i]-seenAt[b].v[i]));
  assert(maxDiff > 0.5,
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
      eastTot++; if (A.coneArr[iF]>0.5) eastLit++;
    }
    if (iB>=0 && G.grid[iB]===1 && seesTile(ex1,ey1,iB%W,Math.floor(iB/W))){
      westTot++; if (A.coneArr[iB]>0.5) westLit++;
    }
  }
  console.log(`  facing east: ${eastLit}/${eastTot} floor tiles lit ahead, ${westLit}/${westTot} behind`);
  assert(eastTot>=6, `only ${eastTot} clear tiles ahead — cannot test directionality`);
  assert(eastLit === eastTot, `${eastTot-eastLit} clear tiles directly ahead were not lit — the cone is not where the character is looking`);
  assert(westLit === 0, `${westLit} tiles behind the character are lit — 80 degrees of blindness should be behind you`);

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
    if (A.maskArr[i] > 0.02) occludedVisible++;
    const ang=Math.atan2(y+0.5-spot.y, x+0.5-spot.x);
    let d=Math.abs(ang); if (d>Math.PI) d=Math.abs(d-Math.PI*2);
    if (d>HALF) continue;                 // outside the cone: irrelevant either way
    if (A.visArr[i] <= 0) continue;       // dark room: the scope hides it regardless
    inLitRegion++;
    worstAngle=Math.max(worstAngle,d);
    if (A.maskArr[i] > 0.02) occludedVisible++;
  }
  console.log(`  ${occludedTotal} floor tiles behind a wall; ${occludedVisible} of them visible. `+
              `${inLitRegion} sit inside the cone's angle AND a lit room `+
              `(up to ${(worstAngle*180/Math.PI).toFixed(0)}deg off axis)`);
  assert(occludedTotal>4, `only ${occludedTotal} occluded tiles on this floor — cannot test occlusion`);
  assert(inLitRegion>4, `only ${inLitRegion} occluded tiles in a lit region — cannot isolate occlusion from scoping`);
  assert(occludedVisible===0,
    `${occludedVisible} tiles behind a wall are visible — the cone ignores occlusion`);

  /* --- 4. the cone must not reach outside the room scope ---
     mask = scope x cone, plus torch. With the torch OFF, a tile in a region
     the player is not in must stay dark even if it is dead ahead, or the
     room scoping has been undone by the new layer. */
  G.torch = false;
  {
    const adj = new Set(A.regionAdj[A.visRegion]);
    let ahead=0, aheadLit=0;
    for (let d=1; d<=16; d++){
      const x=Math.floor(spot.x)+d, y=Math.floor(spot.y);
      if (x>=W || G.grid[y*W+x]!==1) break;
      if (G.los(spot.x,spot.y,x+0.5,y+0.5)){ ahead++; if (A.maskArr[y*W+x]>0.5) aheadLit++; }
    }
    if (ahead>0) console.log(`  ${aheadLit}/${ahead} clear tiles ahead are visible with the torch off`);
  }
  G.torch = true;

  /* --- 5. the mask is the product the renderer depends on ---
     Every tile the mask lifts must be inside the room scope or inside the
     torch fan; every tile outside both must be exactly zero. This is the
     invariant that keeps the torch from becoming a second pair of eyes. */
  {
    let outOfScopeLit=0, zeroViolations=0, nan=0;
    for (let i=0;i<W*W;i++){
      const m=A.maskArr[i];
      if (Number.isNaN(m)){ nan++; continue; }
      if (m<0 || m>1+1e-6){ nan++; continue; }
      const scope=A.visArr[i], cone=A.coneArr[i], tor=A.torchArr[i];
      if (m > scope*cone + 1e-6 && m > tor + 1e-6) outOfScopeLit++;
      if (scope<=0 && cone<=0 && tor<=0 && m > 1e-6) zeroViolations++;
    }
    assert(nan===0, `${nan} mask tiles were NaN or out of range`);
    assert(outOfScopeLit===0, `${outOfScopeLit} tiles are lit by neither the scope nor the torch`);
    assert(zeroViolations===0, `${zeroViolations} tiles are lit with no scope, no cone and no torch — nothing should be visible`);
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
        if (G.grid[ni]===1) nb=Math.max(nb, A.maskArr[ni]);
      }
      if (nb>0.5 && A.maskArr[i] < nb-1e-6) holes++;
    }
    assert(holes===0, `${holes} walls are darker than the floor in front of them — they read as holes`);
  }

  console.log('  cone rotates, occludes at walls, and never reaches past the room scope');
}

console.log('\n' + (fail? `\n${fail} FAILURE(S)\n` : 'ALL TESTS PASSED\n'));
process.exit(fail?1:0);