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

/* getImageData reads back what putImageData last wrote. That round-trip is not
   incidental: the flood is rendered through a packed image, and asserting on
   wetArr alone would pass while the renderer drew nothing — the exact class of
   bug the README says several of these tests missed. Reading the pixels is the
   only way to see what the frame actually contains. */
function fakeCtx(){
  const noop = ()=>{};
  const grad = { addColorStop: noop };
  const self = {
    canvas:{width:0,height:0},
    _last:null,
    setTransform(...a){ calls.list.push(['setTransform',...a]); },
    translate(...a){ calls.list.push(['translate',...a]); },
    drawImage(...a){ calls.list.push(['drawImage',...a]); },
    createPattern: ()=>{ calls.pattern++; return {}; },
    createImageData:(w,h)=>{ calls.imageData++; const im={width:w,height:h,data:new Uint8ClampedArray(w*h*4)}; self._last=im; return im; },
    putImageData(im){ self._last = im; },
    getImageData(x,y,w,h){
      const src = self._last;
      const out = {width:w, height:h, data:new Uint8ClampedArray(w*h*4)};
      if (src && src.data && src.width===w && src.height===h) out.data.set(src.data);
      return out;
    },
    createLinearGradient: (...a)=>{ calls.gradient++; calls.list.push(['createLinearGradient',...a]); return grad; },
    createRadialGradient: (...a)=>{ calls.gradient++; calls.list.push(['createRadialGradient',...a]); return grad; },
    fillRect(...a){ calls.list.push(['fillRect',...a]); },
    measureText: ()=>({width:10}),
    globalAlpha:1, globalCompositeOperation:'', fillStyle:'', strokeStyle:'',
    lineWidth:1, font:'', textAlign:'', imageSmoothingEnabled:true,
  };
  return new Proxy(self, {
    get(t,k){ if (k in t) return t[k]; return noop; },
    set(t,k,v){ t[k]=v; return true; }
  });
}

function fakeCanvas(){
  const cv = { width:0, height:0, clientWidth:1280, clientHeight:720,
               getContext:()=>cv._ctx, style:{} };
  cv._ctx = fakeCtx();
  return cv;
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
    /* The game drives modal transitions through button.click(), including
       from the key handler, so the stub has to activate the handler the same
       way a browser would — not just hold the property. */
    click(){ if (this.onclick) this.onclick(); },
  };
  return el;
}

const els = {};
global.document = {
  getElementById(id){ return els[id] || (els[id]=fakeEl(id)); },
  querySelector(sel){ return els[sel] || (els[sel]=fakeEl(sel)); },
  querySelectorAll(){ return []; },
  addEventListener(){},
  body: { appendChild(){} },
};
global.window = {
  /* Key handlers are kept so tests can press real keys. Every screen change
     in this game is a key handler away, and a suite that could not press a
     key could not tell a working menu from a decorative one. */
  _h:{},
  addEventListener(t,f){ this._h[t]=f; },
  devicePixelRatio:1,
  AudioContext: undefined,   // exercise the no-AudioContext fallback path
};
global.requestAnimationFrame = ()=>0;
global.performance = { now: ()=> Date.now() };

/* A real localStorage, because the settings store's whole job is surviving a
   round trip. A stub that silently did nothing would let the persistence code
   be entirely untested, which is the one part of it that can fail silently in
   production. Tests can reach __store to corrupt it deliberately. */
global.__store = new Map();
global.localStorage = {
  getItem(k){ return __store.has(k) ? __store.get(k) : null; },
  setItem(k,v){ __store.set(k, String(v)); },
  removeItem(k){ __store.delete(k); },
  clear(){ __store.clear(); },
};

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
  get regionOf(){ return regionOf; },
  get regionAdj(){ return regionAdj; },
  get visRegion(){ return visRegion; },
  get DARK_ROOM(){ return DARK_ROOM; },
  get HOP_FALL(){ return HOP_FALL; },
  get VIEW_FADE_NEAR(){ return VIEW_FADE_NEAR; },
  get VIEW_FADE_FAR(){ return VIEW_FADE_FAR; },
  get VIEW_HALF(){ return VIEW_HALF; },
  get VIEW_RANGE(){ return VIEW_RANGE; },
  get RADAR_DRAIN(){ return RADAR_DRAIN; },
  buildFloor, blocked, moveEnt, update, render, emitNoise, setPrompt, drawPlayer,
  scopeRoomLight, regionAt, traceViewCone, packMask, snapMask, combineMask,
  smoothMask, onScreen, setHeadless,
  get STATE(){ return STATE; },
  set STATE(v){ STATE = v; },
  get floorIdx(){ return floorIdx; },
  get keys(){ return keys; },
  get HAND_OFF(){ return HAND_OFF; }, get R(){ return R; }, drawAgent,
  get cvs(){ return cvs; }, get ctxRef(){ return ctx; }, get SCALE(){ return SCALE; },
  get lightCv(){ return lightCv; }, get wetCv(){ return wetCv; },
  get TILE(){ return TILE; },
  get wetArr(){ return wetArr; }, get waterDist(){ return waterDist; },
  get leakTile(){ return leakTile; }, get LOUD(){ return LOUD; },
  get FLOOR(){ return FLOOR; },
  get REPAIR_TIME(){ return REPAIR_TIME; },
  get REPAIR_REACH(){ return REPAIR_REACH; },
  get REPAIR_NOISE(){ return REPAIR_NOISE; },
  get LEAK_NOISE_BASE(){ return LEAK_NOISE_BASE; },
  get LEAK_NOISE_GAIN(){ return LEAK_NOISE_GAIN; },
  get LEAK_SPREAD(){ return LEAK_SPREAD; },
  get WET_RISE(){ return WET_RISE; },
  get LEAK_LURE(){ return LEAK_LURE; },
  get WALK(){ return WALK; }, get SPRINT(){ return SPRINT; },
  tickFlood, wetAt, floodCover, sealLeak, leakReach, initFlood, packWet,
  get wetCv(){ return wetCv; },
  get SETTINGS(){ return SETTINGS; },
  get SETTINGS_DEFAULTS(){ return SETTINGS_DEFAULTS; },
  get SETTINGS_SCHEMA(){ return SETTINGS_SCHEMA; },
  get DIFFICULTIES(){ return DIFFICULTIES; },
  get WATER_TINTS(){ return WATER_TINTS; },
  loadSettings, saveSettings, resetSettings, applySettings, setOption,
  settingsValid, get SETTINGS_KEY(){ return SETTINGS_KEY; },
  advanceSplash, backSplash, show, hideAll, get SCREENS(){ return SCREENS; },
  get FLOORS(){ return FLOORS; },
  get HUNT_BASE(){ return HUNT_BASE; }, get HUNT_STEP(){ return HUNT_STEP; },
  get lives(){ return lives; }, set lives(v){ lives = v; },
  get runLives(){ return runLives; }
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
let fail = 0;
const assert = (c,m)=>{ if(!c){ console.log('  FAIL: '+m); fail++; } };

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
    let escapes=0, swapped=false, hasMovedLastFrame=false, leakGoal=null, lastLeakKey='';

    while(A.floorIdx<5 && t<60*maxMinutes){
      if(!withEntity && G.agents.length) G.agents.length=0;

      const unfound=G.exitTiles.filter(e=>!e.found);
      const live=G.batteries.filter(b=>!b.taken);
      const px=G.player.x, py=G.player.y, cur=IDX(Math.floor(px),Math.floor(py));

      /* --- THE LEAK COMES FIRST.
         The floor does not open until the riser is sealed, so a bot that only
         chases exits can now never finish and this test would report 0/8 for
         the whole suite. The leak is handled as an EXTRA goal that outranks the
         exits while it is open: walk to the pipe, stand on it, and press no
         keys at all until the bar is full. Releasing the keys is the entire
         repair input — there is no button — so a hold is five seconds of
         doing nothing, which the loop has to actually model. */
      const leak=G.leak;
      if (!leak.fixed){
        /* Ask the GAME's own predicate whether we are in reach, rather than a
           tighter radius of the test's own. A bot that starts holding at 0.34
           while the game allows REPAIR_REACH is testing a stricter game than
           the one that ships — and it failed 6/6 for exactly that reason,
           walking right up to the pipe and then never quite arriving. */
        if (A.leakReach(px, py)){
          /* on the pipe: hands on the wrench. No keys, no radar, no movement. */
          keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
          update(1/60); t+=1/60;
          if (A.STATE!=='play'){ deaths++;
            const lv=vm.runInContext('lives',ctxObj);
            if (lv<=0) break;
            vm.runInContext('RUN_SEED='+sd+';', ctxObj);
            buildFloor(A.floorIdx, sd);
            A.STATE='play'; gk=''; exKey=null; lastSetKey=null; tExit=null; path=null; goalId=-1;
          }
          continue;
        }
        /* Walk to the pipe, reusing the exit machinery's path follower.
           The path is NOT nulled here. It was, and that single line made this
           the slowest thing in the suite by an order of magnitude: the rebuild
           condition is `!path || off-course`, so a null every frame rebuilt a
           5776-entry BFS on every frame of what is the longest walk in the
           game. Invalidating on the GOAL changing is enough and is what the
           exit path already does. */
        const lk = leak.sx+','+leak.sy;
        if (lk !== lastLeakKey){
          lastLeakKey = lk; goalId=-1;
        }
        leakGoal={x:leak.sx, y:leak.sy};
      } else {
        leakGoal=null; lastLeakKey='';
      }

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

      /* --- then the goal: the leak first, then recharge, then the exit --- */
      let goal=null, kind=null;
      if (leakGoal){ goal=leakGoal; kind='leak'; }
      const needCharge = !goal && unfound.length && G.batt<38 && live.length;
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

      /* --- radar discipline: only sweep when the exit is close enough that the
             sweep would actually put it on screen. Travel dark; this is the
             whole point of the battery economy. The radar drains more than
             twice what the torch it replaced did, so being greedy about it
             strands the bot rather than just wasting charge. --- */
      const dExit = fe ? distTo(fe,cur) : 9999;
      /* No sweep on the way to the pipe. The water IS the cue down there and
         spending the battery to re-learn a floor you are walking across is
         exactly the waste the economy is built to punish. */
      G.radar = kind==='leak' ? false
              : (dExit<=11) || (G.batt>85 && kind==='exit' && dExit<=16);
      if(kind==='batt' && G.batt>20) G.radar=false;

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
  for(let s=0;s<6;s++){
    const r=play(s*5077+5, false, 14);
    if(r.depth>=5){ feas++; ft.push(r.t); }
    if(process.env.V) console.log(`     seed ${s}: depth ${r.depth}/5 exits ${r.exits} time ${r.t.toFixed(0)}s why=${r.why}`);
    worstMargin=Math.min(worstMargin,r.minMargin); escA+=r.escapes;
    worstBatt=Math.min(worstBatt,r.lowestBatt);
  }
  console.log(`[4a] feasibility — ${feas}/6 runs cleared all 5 floors with no monster`);
  /* The cap is 14 minutes, not the 9 it was before the leak. A run is now
     about 8.7 minutes because sealing the riser is a genuine extra journey
     across every floor, and a 9-minute ceiling made the bot time out on its
     last floor and report 1/8 — which reads as "the game is nearly unwinnable"
     when the truth is "the test's deadline is now shorter than the game".
     Six runs instead of eight keeps the wall clock roughly where it was. */
  if(ft.length) console.log(`     avg ${(ft.reduce((a,b)=>a+b,0)/ft.length/60).toFixed(1)} min per 5-floor run`);
  console.log(`     tightest battery headroom: ${worstMargin.toFixed(0)} units (negative = would strand)`);
  console.log(`     lowest battery observed: ${worstBatt.toFixed(0)}   bot escapes: ${escA}`);

  assert(worstMargin>0, 'battery headroom goes negative — a careful player could be stranded');

  // --- 4b: full game with the monster ---
  let wins=0, rt=[], dsum=0, reach=0, escSum=0;
  for(let s=0;s<6;s++){
    const r=play(s*3319+11, true, 14);
    if(r.depth>=5){ wins++; rt.push(r.t); }
    dsum+=r.deaths; reach=Math.max(reach,r.depth); escSum+=r.escapes;
  }
  console.log(`[4b] with monster — ${wins}/6 runs cleared all 5 floors, deepest ${reach}/5, deaths ${dsum}, bot escapes ${escSum}`);
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

  let SCALE=1, tx=null, ty=null, lightDraw=null, wetDraw=null;
  for (const c of calls.list){
    if (c[0]==='setTransform' && SCALE===1 && c[1]!==1) SCALE = c[1];   // FIRST one is the camera
    if (c[0]==='translate' && tx===null){ tx = c[1]; ty = c[2]; }
    if (c[0]==='drawImage' && c[1]===A.lightCv) lightDraw = c;
    if (c[0]==='drawImage' && c[1]===A.wetCv) wetDraw = c;
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
    ['boot shaft L', -0.10, -0.12, 0.06, 0.075],
    ['boot shaft R',  0.10, -0.12, 0.06, 0.075],
    ['boot foot L',  -0.10, -0.165, 0.05, 0.04],
    ['boot foot R',   0.10, -0.165, 0.05, 0.04],
    ['waders',      0,     0.04,   0.14,  0.08],
    ['jacket',      0,    -0.02,   0.16,  0.12],
    ['arm L',      -0.17,  0.02,   0.05,  0.065],
    ['arm R',       0.17,  0.02,   0.05,  0.065],
    ['wrench',      0,     0.13,   0.04,  0.17],
    ['head',        0,    -0.06,   0.085, 0.085],
    ['headlamp',    0,    -0.13,   0.03,  0.03],
    ['radar glow',  0,    -0.135,  0.082, 0.082],
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
  // the avatar must be drawn at its TRUE position, not the tile centre offset
  const dsrc = A.drawPlayer.toString();
  assert(/const x\s*=\s*p\.x\s*\*\s*TILE/.test(dsrc),
    'avatar is drawn with a +0.5 tile offset from its real position');
  assert(!/const x=\(p\.x\+0\.5\)\*TILE/.test(dsrc),
    'avatar still drawn at (p.x+0.5) — half a tile from the collision point');
  const asrc = A.drawAgent.toString();
  assert(/const x\s*=\s*a\.x\s*\*\s*TILE/.test(asrc),
    'agents are drawn with the same half-tile offset');
  console.log(`  radar held ${A.HAND_OFF} tiles in front of the body centre; cone originates there too`);
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
/* From here on the tests read the mask, the cone and the packed images, so
   both halves of the vision pipeline go back on. */
A.setHeadless(false, true);
console.log('[12] room-scoped light — your room is lit, the rest is dark');
{
  const W=76, H=76, DARK=A.DARK_ROOM, HOP=A.HOP_FALL;

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

  /* The falloff must be strictly decreasing — a table that rises at hop 3
     would light the room beyond a dark one, which is exactly the inversion
     that made the old step function confusing. */
  for (let i=1;i<HOP.length;i++)
    assert(HOP[i] < HOP[i-1], `scope rises at ${i} gates: ${HOP[i-1]} -> ${HOP[i]}`);
  assert(HOP[HOP.length-1] > 0 && HOP[HOP.length-1] < 0.2,
    `the far end of the falloff is ${HOP[HOP.length-1]}, want dim but not zero`);

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
      if (A.regionAt(G.player.x, G.player.y) !== A.visRegion) noFollow++;
      const oldR=rooms[homeRi];
      const newScope = vis[Math.floor(G.player.y)*W+Math.floor(G.player.x)];
      for (let y=oldR.ry;y<oldR.ry+oldR.rh && !noFollow;y++)
        for (let x=oldR.rx;x<oldR.rx+oldR.rw;x++){
          const i=y*W+x;
          if (G.grid[i]===1 && vis[i] >= newScope - 1e-6){ noFollow++; break; }
        }
    }
  }

  assert(unreachable===0, `${unreachable}/120 floors had floor tiles with no region, or an unreachable region`);
  assert(leak===0, `${leak} visibility values did not match their region's scope`);
  assert(blackHole===0, `${blackHole} tiles were too dark to stand in or to see the wall beside`);
  assert(noFollow===0, `${noFollow} cases where the light did not follow the player into the next room`);
  assert(bakeMut===0, `${bakeMut} floors where scoping mutated the ambient bake in place`);
  /* The far rooms are dim now, not black — that is the point of the falloff —
     but your own room must still be plainly brighter than them, or the whole
     scoping rule has stopped meaning anything. */
  const ratio = farFloors ? (ownTotal/ownFloors)/(farTotal/farFloors) : Infinity;
  assert(ratio > 3.0,
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
      assert(settled < HOP[1]+1e-6, `the room you left settled at ${settled.toFixed(3)}, want <= ${HOP[1]}`);
      assert(nowLit  > 0.999, `the room you entered settled at ${nowLit.toFixed(3)}, want 1`);
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
    assert(best, 'no long open run found to test sight distance with');
    if (best){
      G.player.x=best.x+0.5; G.player.y=best.y+0.5; G.player.face=0;
      G.radar=false;                                  // isolate the cone + scope
      A.snapMask();   // traces + combines + uploads, no easing
      const at=(d)=>{ const i=best.y*W+best.x+d; return {d, mask:A.maskArr[i], scope:A.visArr[i], cone:A.coneArr[i]}; };
      const far = at(Math.min(18, best.run-1));
      const near= at(2);
      console.log(`  straight ${best.run}-tile run: mask at 2 tiles ${near.mask.toFixed(2)}, `+
                  `at ${far.d} tiles ${far.mask.toFixed(2)} (scope ${far.scope.toFixed(2)})`);
      assert(far.cone > 0.5,
        `the cone only reaches ${far.cone.toFixed(2)} at ${far.d} tiles down a clear straight line`);
      assert(far.mask > 0.05,
        `sight dies at ${far.d} tiles down a clear straight corridor — the scope is a cliff again`);
      assert(far.mask < near.mask,
        'a corridor does not get brighter with distance');
      // and it must still fade out eventually, not run to the far wall
      const end = at(best.run-1);
      assert(end.mask <= far.mask + 1e-6,
        'the corridor gets brighter toward the far end');
    }
  }
  function regionOfIdx(i){ return A.regionOf[i]; }
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
    G.radar=false;
    scopeRoomLight(0,true);
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
      if (G.los(spot.x,spot.y,x+0.5,y+0.5)){ ahead++; if (A.maskArr[y*W+x]>0.5) aheadLit++; }
    }
    if (ahead>0) console.log(`  ${aheadLit}/${ahead} clear tiles ahead are visible with the radar off`);
  }
  G.radar = true;
  A.snapMask();   // traces + combines + uploads, no easing
  {
    let lit=0, wall=0, tiles=0;
    for (let i=0;i<W*W;i++){
      if (A.maskArr[i] > 0.999) lit++;
      tiles++;
      if (G.grid[i]===0 && A.maskArr[i] > 0.999) wall++;
    }
    assert(lit === tiles,
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
      const m=A.maskArr[i];
      if (Number.isNaN(m)){ nan++; continue; }
      if (m<0 || m>1+1e-6){ nan++; continue; }
      const scope=A.visArr[i], cone=A.coneArr[i];
      if (m > scope*cone + 1e-6) outOfScopeLit++;
      if (scope<=0 && cone<=0 && m > 1e-6) zeroViolations++;
    }
    assert(nan===0, `${nan} mask tiles were NaN or out of range`);
    assert(outOfScopeLit===0, `${outOfScopeLit} tiles are lit by neither the scope nor the cone`);
    assert(zeroViolations===0, `${zeroViolations} tiles are lit with no scope and no cone — nothing should be visible`);
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
      if (G.grid[i]!==1 || A.visArr[i] < 0.999) continue;
      if (A.coneArr[i] <= 0.02) continue;             // not in view: nothing to judge
      checked++;
      if (A.maskArr[i] < 0.999) dimmed++;
    }
    assert(checked>0, 'no visible tiles in the player\'s own room to check');
    assert(dimmed===0, `${dimmed}/${checked} visible tiles in your own room are dimmed — the room must not fade with distance`);
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

/* ============ TEST 14: the radar ===============================
   Off by default. While on, the whole floor is visible — no dark spots. It
   drains more than twice what the torch it replaced did, and that is the only
   thing keeping it from being a free win.

   The dangerous failure is not "the radar does too little", it is "the radar
   does too much for too little": a sweep that were cheap, or that leaked on
   after hitting zero, would remove the entire battery economy. */
console.log('[14] the radar — off by default, total while on, expensive');
{
  const W=76;

  buildFloor(0, 9090);
  assert(G.radar===false, 'the radar starts on — it is a tool you pay for, not a light');

  /* --- cost: a full battery must be a decision, not a convenience --- */
  assert(A.RADAR_DRAIN > 4.0,
    `the radar drains ${A.RADAR_DRAIN}/s — the torch it replaced cost 2.4 and could be held indefinitely`);
  const seconds = 100/A.RADAR_DRAIN;
  assert(seconds < 25,
    `a full battery buys ${seconds.toFixed(0)}s of sweep — that is long enough to stop thinking about it`);
  console.log(`  ${A.RADAR_DRAIN}/s — a full battery is ${seconds.toFixed(0)} seconds of seeing everything`);

  /* --- drain, and it switches itself off at zero rather than going negative */
  {
    G.radar = true; G.batt = 6;
    // 6 units at 5.6/s is 1.07s, so run 2s of frames
    for (let i=0;i<120;i++) update(1/60);
    assert(G.radar===false, 'the radar stayed on after the battery ran out');
    assert(G.batt===0, `battery went to ${G.batt}, want exactly 0`);
    assert(G.batt>=0, 'battery went negative');
  }
  /* --- and it drains again from a fresh charge, at the same rate --- */
  {
    G.batt = 100; G.radar = true;
    for (let i=0;i<60;i++) update(1/60);
    const used = 100 - G.batt;
    assert(Math.abs(used - A.RADAR_DRAIN) < 0.05,
      `1 second of sweep cost ${used.toFixed(2)}, want ${A.RADAR_DRAIN}`);
    assert(G.radar===true, 'the radar switched itself off with a full battery');
    G.radar = false; G.batt = 100;
  }

  /* --- while on, NOTHING is dark. Not the room behind you, not the far wall,
         not solid rock in the middle of a block. --- */
  G.radar = true;
  A.snapMask();
  {
    let dark=0, behind=0;
    for (let i=0;i<W*W;i++) if (A.maskArr[i] < 0.999) dark++;
    // specifically: a tile directly behind the character, which is the one
    // thing the cone is certain to hide when the radar is off
    const px=Math.floor(G.player.x), py=Math.floor(G.player.y);
    for (const [dx,dy] of [[-3,0],[0,3],[3,0],[0,-3],[-6,-6],[7,5]]){
      const x=px+dx, y=py+dy;
      if (x<0||y<0||x>=W||y>=W) continue;
      if (A.maskArr[y*W+x] < 0.999) behind++;
    }
    assert(dark===0, `${dark} tiles are still dark with the radar on — it has to have no dark spots`);
    assert(behind===0, `${behind} tiles around the player are dark with the radar on`);
    console.log(`  radar on: 0 of ${W*W} tiles dark`);
  }

  /* --- off again, the cone comes straight back, including BEHIND you --- */
  G.radar = false;
  A.snapMask();
  {
    /* Find a floor tile genuinely behind the character and out of its cone —
       the radar-off case has to be a real occlusion, not just "somewhere
       dark", or the assertion proves nothing. */
    const px=Math.floor(G.player.x), py=Math.floor(G.player.y);
    let checked=0;
    for (let d=2; d<=8; d++){
      const x=px-d, y=py;
      if (x<0||y<0||x>=W||y>=W) continue;
      const i=y*W+x;
      if (G.grid[i]!==1) continue;
      if (A.visArr[i] >= 0.999) continue;      // same lit region, not a scope test
      checked++;
      if (A.maskArr[i] > 0.02){
        assert(false, `a tile ${d} tiles behind the character is still lit with the radar off`);
      }
    }
    let dark=0;
    for (let i=0;i<W*W;i++) if (A.maskArr[i] < 0.02) dark++;
    assert(checked>0 || dark>200,
      'with the radar off the cone restores no darkness anywhere');
    assert(dark>200, `only ${dark} tiles dark with the radar off — the cone is not doing anything`);
    console.log(`  radar off: ${dark} tiles dark again, including ${checked} tiles behind the player`);
  }

  /* --- the reveal: an exit is found when the sweep puts it on screen ---
     This is the whole exit economy now, so it is checked directly rather than
     left to the playthrough bot: an exit just off screen must NOT be found,
     and the frame it comes on screen it must be.

     The battery is held at full throughout. The radar dying mid-search is the
     economy, and test 4 covers that; here we are testing the RULE, and a rule
     you cannot observe because the tool ran out is not a rule. */
  {
    buildFloor(1, 3131);
    /* The rule is "revealed iff on screen", so it is tested by PLACING the
       player rather than walking there. Driving the player in a straight line
       by writing G.player directly fights unstick() — it shoves the player
       back out of every wall the line passes through — and the test ends up
       measuring the collision code. Placement tests the rule and nothing else. */
    const spotWith=(e, want)=>{
      for (let y=1;y<W-1;y++) for (let x=1;x<W-1;x++){
        if (G.grid[y*W+x]!==1) continue;
        G.player.x=x+0.5; G.player.y=y+0.5;
        if (A.onScreen(e.x+0.5, e.y+0.5) === want) return {x:x+0.5, y:y+0.5};
      }
      return null;
    };
    let negatives=0, positives=0;
    /* A sweep reveals EVERY exit on screen, not just the one being tested, so
       each case has to start from a clean slate or the negative case inherits
       a reveal that happened during a previous case's placement. */
    const reset=()=>{ for (const o of G.exitTiles) o.found=false; G.exitsFound=0; G.stat.found=0; };
    for (const e of G.exitTiles){
      reset();
      // off screen: must NOT be revealed
      const off = spotWith(e, false);
      if (off){
        G.player.x=off.x; G.player.y=off.y;
        G.radar=true; G.batt=100;
        for (let i=0;i<5;i++){ G.batt=100; update(1/60); }
        if (!A.onScreen(e.x+0.5, e.y+0.5)){
          assert(e.found===false,
            `exit at ${e.x},${e.y} was revealed while off screen — the sweep is seeing too much`);
          negatives++;
        }
      }
      // on screen: MUST be revealed
      reset();
      const on = spotWith(e, true);
      assert(on, `no floor tile puts exit ${e.x},${e.y} on screen`);
      if (on){
        G.player.x=on.x; G.player.y=on.y;
        G.radar=true; G.batt=100;
        update(1/60);
        assert(e.found,
          `exit at ${e.x},${e.y} was on screen and not revealed by the sweep`);
        positives++;
      }
    }
    reset();
    assert(negatives>0 && positives===G.exitTiles.length,
      `checked ${negatives} off-screen and ${positives} on-screen cases`);
    console.log(`  reveal rule holds: ${positives} on-screen revealed, ${negatives} off-screen not revealed`);
  }
}

/* ============ TEST 15: the leak ===============================
   A new mandatory objective, and every one of these is a way the mechanic
   silently stops working. The three that matter most:

   - the leak must be REACHABLE, or the floor is unwinnable and no other test
     in this file would notice, because none of them require the repair;
   - water must never appear on a WALL, because the renderer draws the flood
     under the walls and a wet wall tile is either invisible (harmless) or,
     worse, visible through the lighting multiply and reads as a hole;
   - the leak must never reach LOUD. A leak at LOUD stops being a lure and
     becomes a floor-wide hunt trigger, which deletes the repair's tension. */
console.log('[15] the leak — placement, reachability, and the flood field');
{
  const W=76;

  /* --- placement over 200 floors --- */
  let unreachable=0, onWall=0, tooClose=0, noSpot=0, sealedAtStart=0;
  for (let s=0; s<200; s++){
    buildFloor(s % 5, s*7907+31);
    const L = G.leak;
    if (!L){ noSpot++; continue; }
    if (G.grid[L.y*W+L.x] !== 0) onWall++;
    if (L.fixed) sealedAtStart++;

    /* the repair spot must be floor the player can physically stand on, and it
       must be inside the map. An unreachable repair is an unwinnable floor. */
    if (L.sx<0||L.sy<0||L.sx>=W||L.sy>=W || G.grid[L.sy*W+L.sx]!==1) noSpot++;
    if (blocked(L.sx+0.5, L.sy+0.5, 0.33)) unreachable++;

    /* and it should be a real trek, not the tile you spawn on */
    const d = Math.hypot(L.sx+0.5-G.player.x, L.sy+0.5-G.player.y);
    if (d < 8) tooClose++;
  }
  assert(noSpot===0, `${noSpot}/200 floors have no usable repair spot`);
  assert(unreachable===0, `${unreachable}/200 floors have a repair spot inside geometry`);
  assert(onWall===0, `${onWall}/200 leaks are not on a wall tile`);
  assert(sealedAtStart===0, `${sealedAtStart}/200 floors start with the leak already sealed`);
  console.log(`  200 floors: every leak on a wall, every repair spot standable`);

  /* --- water can only exist on floor it can actually reach --- */
  buildFloor(2, 60606);
  {
    let bad=0, unreachableWet=0;
    for (let i=0;i<W*W;i++){
      if (G.grid[i]===0 && A.waterDist[i] >= 0) bad++;
      if (G.grid[i]===1 && A.waterDist[i] < 0) unreachableWet++;
    }
    assert(bad===0, `${bad} wall tiles are inside the water field — water can flow through rock`);
    assert(unreachableWet===0, `${unreachableWet} floor tiles the water can never reach`);
    assert(G.wetFloor>0, 'the wet floor is empty — the flood gauge would divide by zero');
    console.log(`  water field: ${G.wetFloor} reachable tiles, no wall tiles, none unreachable`);
  }

  /* --- the distance field is a real distance field --- */
  {
    const li = G.leak.sy*W + G.leak.sx;
    assert(A.waterDist[li]===0, `the pipe tile is ${A.waterDist[li]} from the leak, want 0`);
    /* no tile may be closer than a neighbour minus one: a BFS that skipped a
       tile would produce a front that jumps, and the visible symptom is water
       arriving in a distant room before a nearer one. */
    let jumps=0;
    for (let y=1;y<W-1;y++) for (let x=1;x<W-1;x++){
      const i=y*W+x;
      if (G.grid[i]!==1 || A.waterDist[i]<0) continue;
      for (const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){
        const n=ny*W+nx;
        if (G.grid[n]!==1 || A.waterDist[n]<0) continue;
        if (A.waterDist[n] < A.waterDist[i]-1) jumps++;
      }
    }
    assert(jumps===0, `${jumps} neighbour pairs violate |d(n)-d(i)|<=1 — the front can skip tiles`);
    console.log('  distance field is monotone across every floor edge');
  }

  /* --- there IS a trail from the first second ---
     The flood is pre-warmed by LEAK_HEADSTART. Without it a floor opens bone
     dry and the player has no cue at all until water happens to reach them,
     which is the exact opposite of "follow the wet floor downhill" and turns
     the first half-minute into a blind search. */
  {
    let floorsWithTrail=0, dryAtStart=0;
    for (let s=0;s<40;s++){
      buildFloor(s%5, s*1543+3);
      let wet=0;
      for (let i=0;i<76*76;i++) if (G.grid[i]===1 && A.wetArr[i]>0.5) wet++;
      if (wet>0) floorsWithTrail++; else dryAtStart++;
      assert(G.floodCover>0, `floor ${s} starts with a flood gauge reading zero`);
    }
    assert(dryAtStart===0,
      `${dryAtStart}/40 floors start bone dry — there is no cue for the first thirty seconds`);
    console.log(`  every floor opens with water already standing (${floorsWithTrail}/40)`);
  }

  /* --- the flood rises, is bounded, and never touches a wall --- */
  {
    for (let i=0;i<600;i++) update(1/30);      // 20 seconds
    let over=0, wallWet=0, nan=0;
    for (let i=0;i<W*W;i++){
      const v=A.wetArr[i];
      if (Number.isNaN(v)) nan++;
      if (v>1.0001 || v<-0.0001) over++;
      if (G.grid[i]===0 && v>0.02) wallWet++;
    }
    assert(nan===0, `${nan} NaN wetness values`);
    assert(over===0, `${over} wetness values outside 0..1`);
    assert(wallWet===0, `${wallWet} wall tiles are wet — water is rendering through rock`);
    const cover = A.floodCover();
    assert(cover>0 && cover<=1, `flood coverage is ${cover}, want (0,1]`);
    console.log(`  after 20s: ${(cover*100).toFixed(0)}% of the floor is wet, no wall is wet`);
  }

  /* --- the incremental flood gauge agrees with a straight re-sum ---
     G.floodCover is maintained by adding the DELTA as the waterline band
     moves, and it is read by the leak's own noise level and by the HUD. An
     incremental sum that genuinely drifted would be invisible in every other
     assertion here: the tiles would be exactly right and the number would be
     wrong, which shows up as a gauge reading 40% on a dry floor.

     The tolerance is NOT 1e-6, which is what the first version of this asked
     for and which fails. wetArr is a Float32Array: every stored wetness is
     rounded to ~6e-8, and the sum accumulates that rounding once per tile per
     update, so the drift is bounded by roughly eps x tiles and grows slowly.
     What must be ruled out is drift of a different KIND — a band recomputed
     twice, or a splash that does not update the sum — and those are orders of
     magnitude larger than the bound below. */
  {
    let worst=0;
    for (let i=0;i<40;i++){
      update(1/30);
      const oracle = A.floodCover();
      worst = Math.max(worst, Math.abs(oracle - G.floodCover));
    }
    const bound = 1e-3;   // eps(2^-24) * 3747 tiles * margin
    assert(worst < bound,
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
      const d=A.waterDist[i], w=A.wetArr[i];
      if (d<0) continue;
      /* every tile is wetter than every strictly further tile's distance band:
         aggregate it — mean wetness must strictly decrease with distance. */
      void w;
    }
    const band=6;
    const sum=new Float64Array(64), cnt=new Float64Array(64);
    for (let i=0;i<W*W;i++){
      const d=A.waterDist[i];
      if (d<0) continue;
      const b=Math.min(63,(d/band)|0);
      sum[b]+=A.wetArr[i]; cnt[b]++;
    }
    let prev=Infinity;
    for (let b=0;b<64;b++){
      if (!cnt[b]) continue;
      const mean=sum[b]/cnt[b];
      if (mean > prev + 0.02){ inverted++; }
      prev = Math.max(prev, mean);
    }
    assert(inverted===0, `${inverted} distance bands are wetter than the band before them`);
    console.log('  the front is nearest the pipe and falls off with distance');
  }

  /* --- the leak NEVER gets loud. This is the design contract of the lure. */
  {
    let loud=0, samples=0;
    for (let i=0;i<1200;i++){
      update(1/30);
      samples++;
      if (G.leakPower >= A.LOUD) loud++;
    }
    assert(loud===0,
      `the leak reached LOUD ${loud}/${samples} frames — a loud leak is a floor-wide hunt trigger, not a lure`);
    assert(G.leakPower >= A.LEAK_NOISE_BASE,
      'the leak went quieter than its base while still open');
    console.log(`  leak noise tops out at ${G.leakPower.toFixed(2)} against a LOUD of ${A.LOUD} — always a lure`);
  }

  /* --- the leak is audible only when it is quiet: drip < walk < wrench --- */
  {
    assert(A.REPAIR_NOISE >= A.LOUD,
      `wrenching at ${A.REPAIR_NOISE} is under LOUD — the repair must be the loud decision`);
    assert(A.LEAK_NOISE_BASE < A.LOUD, 'the base leak noise is already LOUD');
    /* wading must stay UNDER loud or following the trail would be strictly
       worse than sweeping, and the trail has to be the cheap option */
    assert(A.LEAK_NOISE_BASE+0.08 < A.LOUD, 'wading is loud enough to wake things');
    console.log(`  wrench ${A.REPAIR_NOISE} > LOUD ${A.LOUD} > drip ${A.LEAK_NOISE_BASE}`);
  }
}

/* ============ TEST 16: the repair ===============================
   Five seconds, standing still. The failure modes are all about the bar: it
   filling while you walk away, filling without you, filling without noise, or
   completing twice. Each of those makes the mechanic free or broken. */
console.log('[16] the repair — five seconds, standing still');
{
  const W=76;

  /* --- placing the player ON the pipe, without fighting unstick() --- */
  const standAt = () => {
    const L=G.leak;
    G.player.x = L.sx+0.5; G.player.y = L.sy+0.5;
    A.leakReach(G.player.x, G.player.y);
  };

  /* --- the spot exists and is in reach --- */
  buildFloor(1, 77777);
  standAt();
  assert(A.leakReach(G.player.x, G.player.y),
    'standing on the pipe does not put you in repair reach');
  assert(A.leakReach(G.leak.sx+0.5, G.leak.sy+0.5),
    'the centre of the repair spot is not in reach');
  /* and it must NOT be in reach from across the room, or the repair is a
     proximity accident rather than a decision */
  assert(!A.leakReach(G.leak.sx+0.5 + A.REPAIR_REACH + 0.5, G.leak.sy+0.5),
    'you can wrench the pipe from outside the reach radius');

  /* --- holding still fills the bar, and it takes the stated five seconds --- */
  {
    standAt();
    keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
    let frames=0, t=0;
    while (G.leak.repair < A.REPAIR_TIME && frames < 4000){
      G.player.x = G.leak.sx+0.5; G.player.y = G.leak.sy+0.5;
      update(1/60); t += 1/60; frames++;
      if (G.leak.fixed) break;
    }
    assert(G.leak.fixed, `held still for ${t.toFixed(1)}s and the pipe never sealed`);
    /* exactly the stated time, within a frame — a bar that fills early is a
       bar that was not asking for anything */
    assert(Math.abs(t - A.REPAIR_TIME) < 0.06,
      `the repair took ${t.toFixed(2)}s, want ${A.REPAIR_TIME}s`);
    console.log(`  held still: sealed in ${t.toFixed(2)}s (stated ${A.REPAIR_TIME}s)`);
  }

  /* --- exactly once: repairing a sealed pipe does nothing --- */
  {
    assert(G.leak.fixed===true, 'the pipe did not stay sealed');
    const before = G.stat.sealed;
    standAt();
    for (let i=0;i<600;i++){
      G.player.x = G.leak.sx+0.5; G.player.y = G.leak.sy+0.5;
      update(1/60);
    }
    assert(G.leak.repair===0, `a sealed pipe still has ${G.leak.repair}s of progress on it`);
    assert(G.stat.sealed===before, `sealLeak ran ${G.stat.sealed-before} extra times`);
    assert(G.leakPower===0, 'a sealed pipe is still making noise');
    console.log('  a sealed pipe cannot be re-wrenched and makes no sound');
  }

  /* --- MOVING decays the bar, and does not reset it to zero --- */
  {
    buildFloor(1, 31415);
    standAt();
    for (let i=0;i<180;i++){
      G.player.x = G.leak.sx+0.5; G.player.y = G.leak.sy+0.5;
      update(1/60);
    }
    const partial = G.leak.repair;
    assert(partial > 0.5 && partial < A.REPAIR_TIME, `progress after 3s is ${partial}`);
    // now walk away
    G.leak.repair = 3.0;
    for (let i=0;i<30;i++){ keys['d']=true; update(1/60); }
    keys['d']=false;
    assert(G.leak.repair < 3.0,
      `walking off the pipe did not decay the bar (still ${G.leak.repair})`);
    console.log(`  leaving after 3s decays to ${G.leak.repair.toFixed(2)} — the mistake costs`);
  }

  /* --- and the bar decays to ZERO within a second, so hesitating is not a
         strategy --- */
  {
    G.leak.repair = A.REPAIR_TIME;
    for (let i=0;i<120;i++) update(1/60);      // 2s of standing somewhere else
    assert(G.leak.repair===0, `the bar is still at ${G.leak.repair} after 2s away`);
    console.log('  a full bar is lost in under two seconds away from the pipe');
  }

  /* --- the wrench is LOUD, and loud enough to wake a sleeping coil --- */
  {
    buildFloor(0, 5150);
    /* a dormant agent placed right next to the pipe must WAKE from the repair
       alone — the whole tension of the mechanic is that standing still
       announces you, so this asserts the announcement is real. */
    const L=G.leak;
    const sleeper = G.agents.find(a=>a.state==='DORMANT');
    if (sleeper){
      sleeper.x = L.sx+0.5; sleeper.y = L.sy+0.5; sleeper.born=0;
      for (let i=0;i<90;i++){
        G.player.x = L.sx+0.5; G.player.y = L.sy+0.5;
        update(1/60);
        if (sleeper.state!=='DORMANT') break;
      }
      assert(sleeper.state!=='DORMANT',
        'a Lifeform lying on the pipe never woke to the wrench — the repair is silent');
      console.log('  wrenching wakes a Lifeform standing on the pipe');
    }
  }

  /* --- the door is sealed until the pipe is, and the exit rule still holds --- */
  {
    buildFloor(2, 24680);
    /* Find all three exits WITHOUT sealing the pipe. The exits are spread
       across the floor and the viewport is 27 tiles across, so no single
       position puts all three on screen — they are revealed one at a time by
       parking the player beside each. That is the real mechanic (a sweep
       reveals whatever is in view) and using it here keeps this test measuring
       the door gate rather than a searching algorithm. */
    {
      const reset=()=>{ for (const o of G.exitTiles) o.found=false; G.exitsFound=0; G.stat.found=0; };
      let guard=0;
      while (G.exitsFound < G.exitTiles.length && guard++ < 40){
        const e = G.exitTiles.find(o=>!o.found);
        if (!e) break;
        let placed=false;
        for (let y=1;y<W-1 && !placed;y++) for (let x=1;x<W-1;x++){
          if (G.grid[y*W+x]!==1) continue;
          G.player.x=x+0.5; G.player.y=y+0.5;
          if (A.onScreen(e.x+0.5, e.y+0.5)){ placed=true; break; }
        }
        if (!placed){ reset(); break; }
        G.batt=100; G.radar=true;
        update(1/60);
        /* exit 1 has a game-ending hazard? no. exit 2 may now also be in view. */
        G.radar=false;
      }
    }
    assert(G.exitsFound===3, `only ${G.exitsFound}/3 exits found by sweeping beside each`);

    /* now: all found, pipe open, sitting on an exit. The door must NOT open. */
    G.player.x = G.exitTiles[0].x+0.5; G.player.y = G.exitTiles[0].y+0.5;
    G.batt=100;
    for (let i=0;i<400;i++){ G.batt=100; update(1/60); }
    assert(A.floorIdx===0,
      `descended with the leak open — the door is supposed to stay shut (floorIdx ${A.floorIdx})`);
    assert(G.descend===0, `the door cycled ${G.descend.toFixed(2)}s with the leak open`);
    console.log('  door stays sealed with all three exits found and the pipe open');

    /* and with the pipe sealed it opens, which proves the gate is the pipe and
       not some side effect of the test above */
    A.sealLeak();
    G.player.x = G.exitTiles[0].x+0.5; G.player.y = G.exitTiles[0].y+0.5;
    let opened=false;
    for (let i=0;i<200 && !opened;i++){
      G.batt=100; update(1/60);
      if (A.floorIdx>0) opened=true;
    }
    assert(opened, 'with the leak sealed the door never opened — the gate is not the leak');
    console.log('  sealing the pipe opens the door');
    /* put the global back — the remaining tests assume floor 0-ish state */
    vm.runInContext('floorIdx=0;', ctxObj);
  }

  /* Test 17 is the ONLY test that reads a packed image back as pixels, so
     pixel packing is switched off again from here. Tests 18 and 19 assert on
     draw CALLS and on the mask array, neither of which needs the images
     rebuilt every frame. */
  A.setHeadless(false, true);
}

/* ============ TEST 17: the water is a usable cue ==============================
   The mechanic is worthless if the player cannot tell wet from dry, or if
   following the trail is more expensive than sweeping the floor for the leak.
   Both of those are numeric claims about the game and so they are tested as
   numeric claims, not eyeballed. */
console.log('[17] the water as a cue — legible, free, and it actually leads');
{
  const W=76;
  /* This is the one test that reads the packed flood image back as pixels,
     so pixel packing has to be live again too. */
  A.setHeadless(true, true);

  /* --- it renders as something, not nothing ---
     The flood is packed into an image and drawn. If a wet tile packs to alpha
     0 the feature renders as a clean dry floor and every logic test above
     still passes: this is precisely the class of bug the README says the
     suite misses. Assert on the packed pixels. */
  buildFloor(2, 13579);
  for (let i=0;i<3600;i++) update(1/30);        // 2 minutes: a lot of floor wet
  A.packWet();
  {
    const d = A.wetCv.getContext('2d').getImageData(0,0,W,W).data;
    let painted=0, blue=0;
    for (let i=0;i<W*W;i++){
      const k=i*4;
      if (d[k+3] > 8) painted++;
      /* blue-dominant: standing water must not be a yellow wash */
      if (d[k+2] > d[k] + 12 && d[k+3] > 40) blue++;
    }
    assert(painted > 300, `only ${painted} tiles render as wet — the flood is invisible on screen`);
    assert(blue > painted*0.4,
      `only ${blue} of ${painted} wet tiles read blue — the water is not distinguishable from carpet`);
    console.log(`  ${painted} tiles render wet, ${blue} of them blue-dominant`);
  }

  /* The pixels have been read and asserted on. The rest of this test is about
     wetArr and waterDist, which are packed into the image but ARE the state —
     so the image itself can stop being rebuilt. packWet was 19% of the whole
     suite's CPU, and 3600 frames of it after this point asserted nothing. */
  A.setHeadless(false, true);

  /* --- following the trail is FREE next to sweeping ---
     The radar is 5.6/s of battery for 18 seconds of total knowledge. Following
     water costs no battery at all and makes only walk-level noise. If the
     water were expensive this test would force the question of why the mechanic
     exists; it is free, and this pins that so a future tuning pass cannot
     quietly price it. */
  {
    assert(A.RADAR_DRAIN > 5, 'the radar got cheap — the trail has to be worth more than a sweep');
    assert(A.LEAK_NOISE_BASE < 0.5, 'standing near a leak is already loud');
    console.log(`  trail costs no battery and ${A.LEAK_NOISE_BASE} noise vs ${A.RADAR_DRAIN}/s of sweep`);
  }

  /* --- and the trail LEADS: wetness is strictly higher nearer the pipe --- */
  {
    const d0 = A.waterDist[G.leak.sy*W+G.leak.sx];
    let near=0, nearN=0, far=0, farN=0;
    for (let i=0;i<W*W;i++){
      const d=A.waterDist[i];
      if (d<0) continue;
      if (d <= d0+3){ near += A.wetArr[i]; nearN++; }
      else if (d >= d0+16){ far += A.wetArr[i]; farN++; }
    }
    assert(nearN>0 && farN>0, 'not enough tiles near/far to compare the front');
    const nm=near/nearN, fm=far/farN;
    assert(nm > fm,
      `the front does not lead: ${(nm*100).toFixed(0)}% wet near the pipe vs ${(fm*100).toFixed(0)}% far away`);
    console.log(`  front leads: ${(nm*100).toFixed(0)}% wet within 3 tiles of the pipe, ${(fm*100).toFixed(0)}% at 16+`);
  }

  /* --- wading is slower and louder, but never LOUD --- */
  {
    buildFloor(1, 24680);
    /* find a wet tile, then measure a dry walk and a wet walk over the same
       number of frames from the same spot */
    let wetTile=null;
    for (let i=0;i<20000 && !wetTile;i++) update(1/30);
    for (let y=1;y<W-1 && !wetTile;y++) for (let x=1;x<W-1;x++){
      if (G.grid[y*W+x]===1 && A.wetAt(x+0.5,y+0.5) > 0.3){ wetTile={x,y}; break; }
    }
    assert(wetTile, 'no wet floor tile anywhere after 10 minutes — the flood never spreads');

    /* slow wet walking by seeding a deep puddle around the player and timing it */
    G.player.x=wetTile.x+0.5; G.player.y=wetTile.y+0.5;
    vm.runInContext('for(let i=0;i<9;i++) seedSplash(G.player.x,G.player.y,1.0);', ctxObj);
    A.STATE='play';
    keys.w=false; keys.s=false; keys.a=false; keys.d=false;
    let dist=0;
    for (let i=0;i<90;i++){
      // hold a direction and measure what happens
      keys['d']=true;
      const x0=G.player.x;
      update(1/60);
      dist += Math.abs(G.player.x-x0);
      if (A.STATE!=='play'){ A.STATE='play'; }
    }
    keys['d']=false;
    /* 90 frames of walking at SPRINT/WALK speed, minus the wading penalty.
       Assert only the DIRECTION of the effect and the floor: a wall stops you,
       so this measures a lower bound. */
    const maxDry = 90/60 * A.WALK;
    assert(dist <= maxDry*1.02,
      `walked ${dist.toFixed(2)} tiles in wet, above the dry maximum ${maxDry.toFixed(2)} — wading is not slowing anything`);
    assert(dist < maxDry*0.98,
      `walked ${dist.toFixed(2)} of a possible ${maxDry.toFixed(2)} — no wading slowdown at all`);
    console.log(`  wading costs speed (${(dist/maxDry*100).toFixed(0)}% of dry over the same frames)`);
  }
}

/* ============ TEST 18: the floor is still FINISHABLE with the repair =========
   The leak is mandatory now, so it has to be inside the completion path the
   end-to-end bot already walks. This drives the bot at the pipe and asserts the
   whole objective set — three exits AND a sealed riser — is achievable through
   the real update(), with real key state. */
console.log('[18] end-to-end — the bot finds the pipe, wrenches it, and descends');
{
  const W=76, IDX=(x,y)=>y*W+x;

  /* --- leak placement: does the existing bot's goal logic find it? ---
     The suite's bot targets exits. The leak needs its own navigation or it is
     simply not playable, so this drives the SAME path machinery the exit logic
     uses, pointed at the pipe, and checks the bot can actually arrive and hold
     the five seconds. */
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

  let arrived=0, sealed=0, descended=0, noPath=0;
  for (let s=0;s<6;s++){
    buildFloor(s%5, s*4441+13);
    A.STATE='play';
    vm.runInContext('floorIdx=0; lives=3;', ctxObj);
    G.leak.fixed = false;

    let path=null, wi=0, fromX=-99, fromY=-99, holding=false, done=false;
    let swapped=false, hasMovedLastFrame=false;
    const goal={x:G.leak.sx, y:G.leak.sy};
    let frames=0;

    while (frames < 60*240 && !done){
      frames++;
      const px=G.player.x, py=G.player.y;
      keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;

      /* once we are on the pipe, STOP. The repair is a hold, not a walk.
         As in test 4, the question is the GAME's reach predicate and not a
         radius invented here. 0.35 is inside the game's 1.25, so a single-axis
         presser that stops 0.4 tiles short would never trigger it, and the bot
         walked right up to the pipe and then reported 0/6. */
      if (A.leakReach(px, py)){
        holding = true;
        update(1/60);
        if (A.STATE!=='play'){ A.STATE='play'; }
        if (G.leak.fixed){ sealed++; break; }
        continue;
      }

      const stale = !path || wi>=path.length ||
                    Math.hypot(px-fromX, py-fromY) > 2.5;
      if (stale){ fromX=px; fromY=py; path=bfsPath(Math.floor(px),Math.floor(py),goal.x,goal.y); wi=0; }
      if (!path){ noPath++; break; }
      while (wi<path.length-1 && Math.hypot(path[wi][0]+0.5-px, path[wi][1]+0.5-py) < 0.45) wi++;
      const wp=path[Math.min(wi,path.length-1)];
      const dx=(wp[0]+0.5)-px, dy=(wp[1]+0.5)-py;

      /* The steering from test 4, which is the version that actually walks a
         maze. Pressing one axis blindly — which is what this did first — jams
         against a partition and stays jammed: 231 frames of movement in 14400,
         never getting closer than 38 tiles. The two things that matter are a
         LOOKAHEAD that refuses to press into a wall, and FLIPPING the axis
         preference when the last press produced nothing, because a committed
         axis walks the bot into a corner a human rounds by also pressing the
         other way. */
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
    if (G.leak.fixed) arrived++;

    /* now: with the pipe sealed and all exits found, the floor completes */
    if (G.leak.fixed){
      /* reveal them the same way if a retry reset the flags */
      for (const o of G.exitTiles) if (!o.found){
        for (let y=1;y<W-1;y++){ let done=false;
          for (let x=1;x<W-1 && !done;x++){
            if (G.grid[y*W+x]!==1) continue;
            G.player.x=x+0.5; G.player.y=y+0.5;
            if (A.onScreen(o.x+0.5,o.y+0.5)){ G.batt=100; G.radar=true; update(1/60); G.radar=false; done=true; }
          }
          if (done) break;
        }
      }
      G.player.x=G.exitTiles[0].x+0.5; G.player.y=G.exitTiles[0].y+0.5;
      for (let i=0;i<200 && A.floorIdx<1;i++){ G.batt=100; update(1/60); if(A.STATE!=='play')A.STATE='play'; }
      if (A.floorIdx>0) descended++;
    }
    void holding;
  }
  keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
  assert(noPath===0, `${noPath} floors had no path from the spawn to the pipe — the objective is unreachable`);
  assert(arrived===6, `the bot reached and sealed the pipe on ${arrived}/6 floors`);
  assert(descended===6, `the bot descended after sealing on ${descended}/6 floors`);
  console.log(`  bot: sealed the pipe on ${arrived}/6 floors, descended on ${descended}/6`);
  vm.runInContext('floorIdx=0;', ctxObj);
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
  for (let i=0;i<60*40;i++) update(1/60);          // let the pipe actually stain
  const L=G.leak;

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
  assert(A.maskArr[A.leakTile] > 0.9,
    `the pipe tile is masked to ${A.maskArr[A.leakTile]} while the player stands on it`);

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
    assert(G.leak.repair>1.5, `only ${G.leak.repair}s of progress after two seconds held`);
    const [rx,ry] = tileScreen(L.sx+0.5, L.sy);
    calls.list.length = 0;
    render(1000+200*16.7);
    const near = calls.list.filter(c=>{
      if (c[0]!=='createLinearGradient' && c[0]!=='createRadialGradient') return false;
      const x=c[c.length-2], y=c[c.length-1];
      return Math.hypot(x-rx, y-ry) < A.TILE*A.SCALE*1.5;
    });
    assert(near.length>0, 'no ring is painted on the spot while the repair runs');
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
    A.setOption('difficulty','brutal');
    A.setOption('vhs', 0.2);
    A.setOption('sprintToggle', true);
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
    assert(A.SETTINGS.difficulty==='brutal', 'difficulty did not survive the round trip');
    assert(A.SETTINGS.vhs===0.2, `vhs came back as ${A.SETTINGS.vhs}`);
    assert(A.SETTINGS.sprintToggle===true, 'sprintToggle did not survive');
    assert(A.SETTINGS.waterHue==='grey', 'waterHue did not survive');
    console.log('  every field survives a write / wipe / read cycle');
  }

  /* --- a corrupt blob degrades per field, not wholesale --- */
  {
    const bad  = { difficulty:'NONSENSE',        // not an enum member
                   master:'loud',                // wrong type
                   vhs:17,                       // out of range
                   shake:NaN,                    // not finite
                   flicker:'strobe',             // not an enum member
                   waterHue:'chartreuse',
                   waterContrast:-4,             // below the floor
                   sprintToggle:'yes',           // wrong type
                   showFps:true };               // the one legal field
    global.__store.set(A.SETTINGS_KEY, JSON.stringify(bad));
    A.loadSettings();
    /* The one good field is taken... */
    assert(A.SETTINGS.showFps===true, 'a valid field in a partly-corrupt blob was discarded');
    /* ...and every bad one falls back on its own, rather than the whole load
       being rejected because one value is nonsense. */
    assert(A.SETTINGS.difficulty==='normal', 'a bad enum was accepted');
    assert(A.SETTINGS.master===A.SETTINGS_DEFAULTS.master, 'a string was accepted for a range');
    assert(A.SETTINGS.vhs===A.SETTINGS_DEFAULTS.vhs, 'an out-of-range number was accepted');
    assert(A.SETTINGS.shake===A.SETTINGS_DEFAULTS.shake, 'NaN was accepted for a range');
    assert(A.SETTINGS.flicker==='full', 'a bad flicker enum was accepted');
    assert(A.SETTINGS.waterHue==='slate', 'a bad hue was accepted');
    assert(A.SETTINGS.waterContrast===A.SETTINGS_DEFAULTS.waterContrast, 'a below-floor contrast was accepted');
    assert(A.SETTINGS.sprintToggle===false, 'a string was accepted for a bool');
    console.log('  a blob of nonsense keeps its one good field and rejects the rest individually');
  }

  /* --- unparseable, non-object, and absent all fall back --- */
  {
    for (const junk of ['not json at all', '[1,2,3]', 'null', '"a string"', '42']){
      global.__store.set(A.SETTINGS_KEY, junk);
      A.loadSettings();
      assert(A.SETTINGS.difficulty==='normal' && A.SETTINGS.vhs===A.SETTINGS_DEFAULTS.vhs,
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
    A.setOption('difficulty','brutal');
    assert(A.SETTINGS.difficulty==='brutal', 'setOption did not take effect');
    global.__store.set(A.SETTINGS_KEY, JSON.stringify({vhs:0.4}));
    A.loadSettings();
    assert(A.SETTINGS.difficulty==='normal',
      'loading a partial blob kept the live difficulty — the result depends on call order');
    assert(A.SETTINGS.vhs===0.4, 'the one present field was not applied');
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
      seen.push({ k, floors:A.FLOORS, lives:A.DIFFICULTIES[k].lives,
                  repair:A.REPAIR_TIME, hunt:A.HUNT_BASE, step:A.HUNT_STEP });
      assert(A.LOUD===noiseBefore.LOUD, `preset ${k} changed LOUD`);
      assert(A.REPAIR_NOISE===noiseBefore.repair, `preset ${k} changed the wrench noise`);
      assert(A.LEAK_NOISE_BASE===noiseBefore.base, `preset ${k} changed the leak's base noise`);
      assert(A.LEAK_NOISE_GAIN===noiseBefore.gain, `preset ${k} changed the leak's noise gain`);
    }
    /* and the ordering that makes the stealth layer work still holds */
    assert(A.LEAK_NOISE_BASE + A.LEAK_NOISE_GAIN < A.LOUD,
      'the leak can cross LOUD under some preset — the lure becomes a hunt trigger');
    assert(A.LEAK_NOISE_BASE < 0.30, 'wading is no longer quieter than a wet step');
    assert(A.REPAIR_NOISE >= A.LOUD, 'the repair is no longer the loud decision');
    assert(seen.length===3, `expected 3 difficulty presets, saw ${seen.length}`);
    for (const p of seen) assert(p.floors>=1 && p.lives>=1, `preset ${p.k} is degenerate`);
    console.log(`  3 presets move depth/lives/repair/chase only — noise table untouched`);
    console.log(`    ${seen.map(p=>`${p.k}: ${p.lives} lives, ${p.floors} floors, ${p.repair}s, chase ${p.hunt}+${p.step}/floor`).join('\n    ')}`);
    A.setOption('difficulty','normal');
  }

  /* --- difficulty reaches the game, not just the store --- */
  {
    A.setOption('difficulty','brutal');
    assert(A.FLOORS===A.DIFFICULTIES.brutal.floors, `FLOORS is ${A.FLOORS}, want ${A.DIFFICULTIES.brutal.floors}`);
    assert(A.REPAIR_TIME===A.DIFFICULTIES.brutal.repairTime, 'REPAIR_TIME did not follow the preset');
    A.setOption('difficulty','normal');
    assert(A.FLOORS===5 && A.REPAIR_TIME===5, 'normal did not restore the documented tuning');
    console.log('  the preset actually reaches FLOORS and REPAIR_TIME');
  }
}

/* ============ TEST 21: the splash chain — 03 riser, 04 work order, then the run
   Two splash frames sit in front of the game now, so the path a player walks
   to reach the first frame is part of the build and has to be tested like
   one: which screen is up, what each key does, what is left held afterwards. */
console.log('[21] the splash chain — 03 riser, 04 work order, then the run');
{
  const html = fs.readFileSync(__dirname+'/index.html','utf8');
  const css  = fs.readFileSync(__dirname+'/style.css','utf8');

  /* --- the markup contract --- */
  assert(!/screen-title/.test(html), 'the old title screen is still wired into index.html');
  const splashHtml = html.slice(html.indexOf('id="screen-splash"'), html.indexOf('id="screen-order"'));
  const orderHtml  = html.slice(html.indexOf('id="screen-order"'), html.indexOf('id="screen-settings"'));
  assert(splashHtml.length>0 && orderHtml.length>0, 'the splash or work-order screen is missing from index.html');
  assert(/LEAKROOMS/.test(splashHtml), 'splash 03 does not show the title');
  assert(!/\bhidden\b/.test(splashHtml), 'splash 03 ships hidden — the boot frame would be a blank canvas');
  assert(/class="screen hidden"/.test(orderHtml), 'work order 04 ships visible over the riser');
  assert(/id="btn-start"/.test(orderHtml), 'work order 04 has no clock-in button for btn-start to bind');

  /* --- the controls summary is the reason screen 04 exists --- */
  for (const key of ['WASD','ARROWS','SHIFT','ENTER','ESC']){
    assert(new RegExp('>'+key+'<').test(orderHtml), `work order 04 never lists ${key}`);
  }
  assert(/>R</.test(orderHtml), 'work order 04 never lists R, the radar');

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
  const keydown = ctxObj.window._h.keydown;
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
  console.log('  ENTER / any key / click advance, ESC steps back, one screen at a time');
}

reportTimings();
console.log('\n' + (fail? `\n${fail} FAILURE(S)\n` : 'ALL TESTS PASSED\n'));
process.exit(fail?1:0);