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
    /* arc and stroke are recorded because the repair ring is drawn with them
       and nothing else. It used to be asserted through the leak's gradients
       instead, which is measuring a different object two inches away and lands
       exactly on the tolerance boundary for any pipe north or south of the
       spot — a test that passes or fails on the seed. */
    arc(...a){ calls.list.push(['arc',...a]); },
    stroke(...a){ calls.list.push(['stroke',...a]); },
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
  /* The game builds its own canvases (the light bake, the mask, the packed
     flood field, the procedural textures) rather than declaring them in markup,
     so the harness has to hand out elements too. Without this the module fails
     to LOAD, which is worth stating plainly: a stub gap here does not fail one
     assertion, it kills the entire suite before a single test runs. */
  createElement(tag){ return tag==='canvas' ? fakeCanvas() : fakeEl(tag); },
  addEventListener(){},
  body: { appendChild(){} },
};
global.__audioNodes = [];
/* An AudioParam that remembers what it was last TOLD to do. The real one does
   not write `.value` back when you schedule a ramp — setTargetAtTime is a
   schedule, not an assignment — so a test that reads `.value` to find out where
   a gain is going is reading the wrong number in the browser and in here. */
function fakeParam(v){
  return { value:v, _scheduled:null,
    setValueAtTime(x){ this._scheduled=x; },
    setTargetAtTime(x){ this._scheduled=x; },
    linearRampToValueAtTime(x){ this._scheduled=x; },
    exponentialRampToValueAtTime(x){ this._scheduled=x; },
    cancelScheduledValues(){ this._scheduled=null; }, setValueCurveAtTime(){} };
}
function fakeAudioNode(kind){
  const n = {
    kind, _out: [], _starts: 0, _stops: 0, _mod: false,
    connect(x){
      /* A node connected to something that is not a node is a MODULATOR: an
         LFO feeding filter.frequency, or a gain feeding a panner. It has no
         node-path to the destination by design and is not an orphan. */
      if (!x || x.kind===undefined) n._mod = true;
      else n._out.push(x);
      return x;
    },
    disconnect(){ n._out.length = 0; },
    start(){ n._starts++; }, stop(){ n._stops++; },
    gain: fakeParam(1), frequency: fakeParam(440), detune: fakeParam(0),
    Q: fakeParam(1), playbackRate: fakeParam(1),
    buffer: null, loop: false, type: 'sine', pan: fakeParam(0),
  };
  global.__audioNodes.push(n);
  return n;
}
/* A Web Audio stub that RECORDS THE GRAPH.

   The harness deliberately runs the whole suite with no AudioContext, which is
   the right call for exercising the fallback path and is also why a completely
   silent game stayed silent through every run: with no context `Audio_.ok` is
   false and every voice method returns on its first line without building a
   single node. Nothing in this file had ever constructed the audio graph.

   So this builds one on demand and remembers every node, so the wiring can be
   walked. A synthesis bug is only findable by synthesising. */
function fakeAudioContext(){
  return {
    currentTime: 0, sampleRate: 48000, state: 'running',
    destination: { isDestination: true },
    createGain: ()=>fakeAudioNode('gain'),
    createOscillator: ()=>fakeAudioNode('osc'),
    createBufferSource: ()=>fakeAudioNode('bufsrc'),
    createBiquadFilter: ()=>fakeAudioNode('biquad'),
    createStereoPanner: ()=>fakeAudioNode('pan'),
    createBuffer: (ch,len)=>({ length:len, getChannelData: ()=>new Float32Array(len) }),
    resume(){ this.state='running'; return Promise.resolve(); },
    suspend(){ this.state='suspended'; return Promise.resolve(); },
    close(){ this.state='closed'; return Promise.resolve(); },
  };
}
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

/* seeded RNG for deterministic fuzzing */
const seededRNG = vm.runInContext('mulberry32(0xC0FFEE)', ctxObj);

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
  buildFloor, blocked, moveEnt, render, emitNoise, setPrompt, drawPlayer,
  frame,
  updateReal: update,
  /* Every test that is not ABOUT the clock holds it open.
     The game now ends a level when the clock runs out, and update() returns
     immediately once it has — so a test that drives twenty thousand frames
     spends its whole run dead on arrival and reports it as "the AI stopped
     working" or "the battery stopped draining". The failure is indistinguishable
     from a real bug unless it is impossible by construction, so it is: the
     default harness entry point pushes the deadline out of the way, and the two
     tests that genuinely care about it (the playthrough's clock headroom, and
     the clock test itself) call updateReal. */
  update(dt){ if (G) G.clock = 1e6; return update(dt); },
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
  get wetFront(){ return wetFront; },
  get WET_DRAW(){ return WET_DRAW; },
  get LOUD(){ return LOUD; },
  LEVELS, LEVELS_N, get FLOOR_CLOCK(){ return FLOOR_CLOCK; },
  get WET_FALL(){ return WET_FALL; },
  get LEAK_HEADSTART(){ return LEAK_HEADSTART; },
  get RISER_GAP(){ return RISER_GAP; },
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
  tickFlood, wetAt, floodCover, sealLeak, leakReach, leakAt, initFlood, packWet,
  Audio_,
  get wetCv(){ return wetCv; },
  get SETTINGS(){ return SETTINGS; },
  get SETTINGS_DEFAULTS(){ return SETTINGS_DEFAULTS; },
  get SETTINGS_SCHEMA(){ return SETTINGS_SCHEMA; },
  get DIFFICULTIES(){ return DIFFICULTIES; },
  get WATER_TINTS(){ return WATER_TINTS; },
  loadSettings, saveSettings, resetSettings, applySettings, setOption,
  settingsValid, get SETTINGS_KEY(){ return SETTINGS_KEY; },
  advanceSplash, backSplash, show, hideAll, get SCREENS(){ return SCREENS; },
  paintSplashPlan, rollRunSeed, get RUN_SEED(){ return RUN_SEED; },
  togglePause, clockText,
  get FLOORS(){ return FLOORS; },
  get HUNT_BASE(){ return HUNT_BASE; }, get HUNT_STEP(){ return HUNT_STEP; },
  get lives(){ return lives; }, set lives(v){ lives = v; },
  get runLives(){ return runLives; },
  /* the cast, inlined: the avatar's rig and the thing hunting it */
  drawRigger, drawStalker,
  /* their shared gait clock, so the tests can drive the walk cycle */
  stride, footPlan, feet,
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

    /* THE DOOR: exactly one, on a wall tile, touching walkable floor, and it
       is where the player came in — i.e. in the room they spawn in. A door the
       player has to search for is a different game, and a door they cannot
       walk back to inside three minutes is an unwinnable level. */
    assert(G.exitTiles.length===1, `seed ${s}: got ${G.exitTiles.length} exits, want 1`);
    const door = G.exitTiles[0];
    assert(g[door.y*W+door.x]===0, `seed ${s}: the door at ${door.x},${door.y} is not a wall tile`);
    const doorTouch=[[door.x+1,door.y],[door.x-1,door.y],[door.x,door.y+1],[door.x,door.y-1]]
      .some(([x,y])=> x>=0&&y>=0&&x<W&&y<H && g[y*W+x]===1);
    assert(doorTouch, `seed ${s}: door at ${door.x},${door.y} touches no floor`);
    assert(door.found===undefined && door.open===0,
      `seed ${s}: the door carries discovery state — there is nothing left to find`);

    /* THE RISERS: exactly what this level says it has, every one on a wall tile
       with a standable spot beside it. */
    const spec = A.LEVELS[Math.min(s%A.LEVELS.length, A.LEVELS_N-1)];
    assert(G.leaks.length===spec.leaks,
      `seed ${s}: level ${s%A.LEVELS.length} has ${G.leaks.length} risers, want ${spec.leaks}`);
    assert(G.leaksOpen===spec.leaks, `seed ${s}: leaksOpen is ${G.leaksOpen}, want ${spec.leaks}`);
    assert(G.risers===spec.leaks, `seed ${s}: risers tally is ${G.risers}, want ${spec.leaks}`);
    for (const L of G.leaks){
      assert(g[L.y*W+L.x]===0, `seed ${s}: a riser is not on a wall tile`);
      assert(g[L.sy*W+L.sx]===1, `seed ${s}: a riser's repair spot is not floor`);
      assert(L.fixed===false && L.repair===0, `seed ${s}: a riser starts already worked`);
    }
    /* The risers must not be stacked on one wall: four bursts four tiles apart
       are four repairs in the same breath, which is a counting exercise and not
       a level. Measured on the STANDING SPOTS, because that is what decides
       whether one five-second hold can reach two pipes. */
    for (let a=0;a<G.leaks.length;a++) for (let b=a+1;b<G.leaks.length;b++){
      const d = Math.hypot(G.leaks[a].sx-G.leaks[b].sx, G.leaks[a].sy-G.leaks[b].sy);
      assert(d > A.REPAIR_REACH,
        `seed ${s}: two risers can be sealed by one hold (spots ${d.toFixed(2)} apart)`);
      const dw = Math.hypot(G.leaks[a].x-G.leaks[b].x, G.leaks[a].y-G.leaks[b].y);
      assert(dw>=3, `seed ${s}: two risers are ${dw.toFixed(1)} tiles apart`);
    }

    /* THE LIFEFORMS: exactly what this level says it has, and never standing in
       the room the player walks into. */
    assert(G.agents.length===spec.forms,
      `seed ${s}: level ${s%A.LEVELS.length} has ${G.agents.length} lifeforms, want ${spec.forms}`);
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
    keys['w']=seededRNG()<0.34; keys['a']=seededRNG()<0.34;
    keys['s']=seededRNG()<0.34; keys['d']=seededRNG()<0.34;
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
  /* Level 5, deliberately. The count of things in the building is a property of
     the level now and level 1 has exactly one, so a test that wanted both a
     dormant coil and a woken hunter has to ask a level that has both. */
  buildFloor(A.LEVELS_N-1, 999);
  let bad=0, hunted=0, dormant=0;
  for (let i=0;i<20000;i++){
    if (i%11===0){
      emitNoise(1.0, G.player.x, G.player.y);
      for (const a of G.agents) emitNoise(1.0, a.x, a.y);
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
    vm.runInContext('RUN_SEED='+sd+';', ctxObj);
    buildFloor(SF, sd);
    A.STATE='play';
    vm.runInContext(`lives=3; floorIdx=${SF}; runTime=0;`, ctxObj);
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
            const lv=vm.runInContext('lives',ctxObj);
            if (lv<=0) break;
            vm.runInContext('RUN_SEED='+sd+';', ctxObj);
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
         world that needs finding: the door is where you came in and the risers
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
        const lv=vm.runInContext('lives',ctxObj);
        if(lv<=0) break;
        vm.runInContext('RUN_SEED='+sd+';', ctxObj);
        buildFloor(A.floorIdx, sd);
        A.STATE='play'; gk=''; path=null; goalId=-1;
      }
    }
    keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
    if(A.floorIdx>=5) why='completed';
    else if(vm.runInContext('lives',ctxObj)<=0) why='lost all 3 lives on level '+A.floorIdx;
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

  /* --- the reveal: a scrawl is read when the sweep puts it on screen ---
     There is nothing left in the world that NEEDS finding — the door is where
     you came in and the risers announce themselves in water — so the radar is
     down to reading the carpet. That makes the on-screen rule the whole of
     what it does, and it is checked directly rather than left to the playthrough
     bot: a scrawl just off screen must NOT be read, and the frame it comes on
     screen it must be.

     The battery is held at full throughout. The radar dying mid-search is the
     economy, and test 4 covers that; here we are testing the RULE, and a rule
     you cannot observe because the tool ran out is not a rule. */
  {
    buildFloor(1, 3131);
    /* The rule is "read iff on screen", so it is tested by PLACING the player
       rather than walking there. Driving the player in a straight line by
       writing G.player directly fights unstick() — it shoves the player back
       out of every wall the line passes through — and the test ends up
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
    const reset=()=>{ for (const o of G.graffiti) o.seen=false; };
    for (const gr of G.graffiti){
      reset();
      // off screen: must NOT be read
      const off = spotWith(gr, false);
      if (off){
        G.player.x=off.x; G.player.y=off.y;
        G.radar=true;
        for (let i=0;i<5;i++){ G.batt=100; update(1/60); }
        if (!A.onScreen(gr.x+0.5, gr.y+0.5)){
          assert(gr.seen===false,
            `a scrawl was read while off screen — the sweep is seeing too much`);
          negatives++;
        }
      }
      // on screen: MUST be read
      reset();
      const on = spotWith(gr, true);
      if (on){
        G.player.x=on.x; G.player.y=on.y;
        G.radar=true; G.batt=100;
        update(1/60);
        assert(gr.seen, 'a scrawl was on screen and not read by the sweep');
        positives++;
      }
    }
    reset();
    assert(positives===G.graffiti.length && negatives>0,
      `checked ${negatives} off-screen and ${positives}/${G.graffiti.length} on-screen cases`);
    console.log(`  reveal rule holds: ${positives} on-screen read, ${negatives} off-screen not read`);
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
console.log('[15] the risers — placement, reachability, and the flood field');
{
  const W=76;

  /* --- placement over 200 levels, and every riser on every level --- */
  let unreachable=0, onWall=0, tooClose=0, noSpot=0, sealedAtStart=0, wrongCount=0, risers=0;
  for (let s=0; s<200; s++){
    buildFloor(s % A.LEVELS_N, s*7907+31);
    const spec = A.LEVELS[s % A.LEVELS_N];
    if (G.leaks.length !== spec.leaks){
      wrongCount++;
      continue;
    }
    for (const L of G.leaks){
      risers++;
      if (!L){ noSpot++; continue; }
      if (G.grid[L.y*W+L.x] !== 0) onWall++;
      if (L.fixed) sealedAtStart++;

      /* the repair spot must be floor the player can physically stand on, and it
         must be inside the map. An unreachable repair is an unwinnable level —
         and with a clock on the level, an unwinnable one is a dead one. */
      if (L.sx<0||L.sy<0||L.sx>=W||L.sy>=W || G.grid[L.sy*W+L.sx]!==1) noSpot++;
      if (blocked(L.sx+0.5, L.sy+0.5, 0.33)) unreachable++;

      /* and it should be a real trek, not the tile you spawn on */
      const d = Math.hypot(L.sx+0.5-G.player.x, L.sy+0.5-G.player.y);
      if (d < 8) tooClose++;
    }
  }
  assert(wrongCount===0, `${wrongCount}/200 levels built the wrong number of risers`);
  assert(noSpot===0, `${noSpot}/${risers} risers have no usable repair spot`);
  assert(unreachable===0, `${unreachable}/${risers} risers have a repair spot inside geometry`);
  assert(onWall===0, `${onWall}/${risers} risers are not on a wall tile`);
  assert(sealedAtStart===0, `${sealedAtStart} risers start already sealed`);
  console.log(`  200 levels, ${risers} risers: every one on a wall, every repair spot standable`);

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

  /* --- the distance field is a real distance field ---
     MULTI-SOURCE: distance to the NEAREST riser. Every riser's own standing
     spot must therefore sit at zero, and the field must still be monotone — a
     multi-source BFS that seeded the second riser without checking whether the
     first had already reached it would produce a field with two zero basins and
     water arriving in the wrong order between them. */
  {
    let missing=0, jumps=0;
    for (const L of G.leaks){
      const li = L.sy*W + L.sx;
      if (A.waterDist[li]!==0) missing++;
    }
    assert(missing===0,
      `${missing}/${G.leaks.length} risers do not sit at distance 0 — the field is not seeded from all of them`);
    /* no tile may be closer than a neighbour minus one: a BFS that skipped a
       tile would produce a front that jumps, and the visible symptom is water
       arriving in a distant room before a nearer one. */
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
    console.log(`  distance field seeded from all ${G.leaks.length} risers and monotone across every floor edge`);
  }

  /* --- there IS a trail from the first second ---
     The flood is pre-warmed by LEAK_HEADSTART. Without it a level opens bone
     dry and the player has no cue at all until water happens to reach them,
     which is the exact opposite of "follow the wet floor downhill" and turns
     the first half-minute into a blind search. */
  {
    let floorsWithTrail=0, dryAtStart=0;
    for (let s=0;s<40;s++){
      buildFloor(s%A.LEVELS_N, s*1543+3);
      let wet=0;
      for (let i=0;i<76*76;i++) if (G.grid[i]===1 && A.wetArr[i]>0.5) wet++;
      if (wet>0) floorsWithTrail++; else dryAtStart++;
      assert(G.floodCover>0, `level ${s} starts with a flood gauge reading zero`);
    }
    assert(dryAtStart===0,
      `${dryAtStart}/40 levels start bone dry — there is no cue for the first thirty seconds`);
    console.log(`  every level opens with water already standing (${floorsWithTrail}/40)`);
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
    const wetCount = ()=>{ let n=0; for(let i=0;i<N;i++) if (A.wetArr[i] > A.WET_DRAW) n++; return n; };
    const drawnTiles = ()=>{
      A.packWet();
      const d = A.wetCv.getContext('2d').getImageData(0,0,76,76).data;
      let n=0; for(let i=0;i<N;i++) if (d[i*4+3] > 8) n++;
      return n;
    };
    /* tickFlood directly: this is about the water, and driving 500 simulated
       seconds through the whole update() to watch a number fall is 10x the cost
       for nothing. The wiring is proved separately, below. */
    const run = (secs)=>{ for (let i=0;i<secs*4;i++) A.tickFlood(0.25); };

    const adv0 = A.wetFront;
    run(60);
    const adv = A.wetFront - adv0;
    const cover0 = G.floodCover, wet0 = wetCount(), px0 = drawnTiles();
    assert(wet0 > 200 && px0 > 200 && cover0 > 0.05,
      `the level never actually flooded (${wet0} tiles, ${px0} drawn) — there is nothing to recede`);

    for (const L of G.leaks) A.sealLeak(L);
    assert(G.leaksOpen===0, 'the level still has open risers — nothing to recede from');

    /* 1. the waterline is symmetric */
    const f0 = A.wetFront;
    run(60);
    const rec = f0 - A.wetFront;
    assert(Math.abs(adv - 60/A.LEAK_SPREAD) < 0.5,
      `the flood advanced ${adv.toFixed(2)} tiles in 60s, want ${(60/A.LEAK_SPREAD).toFixed(2)}`);
    assert(Math.abs(rec - adv) < 0.5,
      `the flood receded ${rec.toFixed(2)} tiles in 60s but advanced ${adv.toFixed(2)} — `+
      'the waterline is not symmetric');
    assert(Math.abs(rec - 60/A.WET_FALL) > 1,
      'the recession is still running at the old WET_FALL pace');

    /* 2. and the water is actually going with it — checked on the array AND on
       the packed image, because "the flood recedes" and "the flood is visible
       receding" are different claims and only one of them is the game. */
    const cover1 = G.floodCover, wet1 = wetCount(), px1 = drawnTiles();
    assert(cover1 < cover0*0.7, `coverage only fell ${(cover0*100).toFixed(0)}% -> ${(cover1*100).toFixed(0)}%`);
    assert(wet1 < wet0*0.7, `${wet0} wet tiles became ${wet1} — the water is not going anywhere`);
    assert(px1 < px0*0.8, `${px0} wet tiles still draw as ${px1} — the image is not drying`);

    /* 3. no stranded ring. The tile the waterline abandons FIRST is the one the
       old bound dropped on the frame it was passed, and it is the single tile
       whose behaviour distinguishes "receding" from "the front moved". */
    let outer=-1;
    for (let i=0;i<N;i++) if (A.waterDist[i] > 0 && A.waterDist[i] <= f0-3 && A.wetArr[i] > 0.5){ outer=i; break; }
    assert(outer>=0, 'no wet tile outside the front to watch — the test cannot see the bug');
    const wOuter = A.wetArr[outer];
    run(20);
    assert(A.wetArr[outer] < wOuter*0.7,
      `a tile the waterline abandoned is still at ${A.wetArr[outer].toFixed(2)} — `+
      'it was dropped from the pass and never dried');

    /* 4. and it ends up dry */
    run(600);
    assert(A.wetFront===0, `the front stopped at ${A.wetFront} instead of returning to the pipes`);
    const wetEnd = wetCount(), pxEnd = drawnTiles();
    assert(wetEnd < Math.max(4, wet0*0.02),
      `${wetEnd} of ${wet0} tiles are still wet long after the water should be gone`);
    assert(pxEnd < Math.max(4, px0*0.02),
      `${pxEnd} of ${px0} tiles still draw as wet long after the water should be gone`);
    assert(G.floodCover < 0.01, `the flood gauge is still reading ${(G.floodCover*100).toFixed(1)}%`);

    /* the whole thing is reachable through the real update(), not only by
       calling the flood directly */
    A.STATE='play'; vm.runInContext('lives=3;', ctxObj);
    const before = A.wetFront;
    update(1/30);
    assert(A.wetFront < before || A.wetFront===0, 'update() no longer drives the flood');
    A.setHeadless(false, false);
    console.log(`  waterline +${adv.toFixed(1)}/-${rec.toFixed(1)} tiles per 60s; `+
      `${wet0} wet tiles -> ${wet1} -> ${wetEnd}, ${px0} drawn -> ${px1} -> ${pxEnd}`);
  }

  /* --- the leak NEVER gets loud. This is the design contract of the lure —
         and with several risers open at once it is a contract about the TOTAL,
         not about each one. Four standing sources that are individually quiet
         are collectively the loudest thing in the building if each is allowed
         its own full share, which would turn every late level into a hunt with
         no off switch. --- */
  {
    /* Builds its own level, and level 5, because the claim is about several
       risers being open at once — and because a block that inherits whatever
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
    assert(loud===0,
      `the open risers reached LOUD ${loud}/${samples} samples — a loud leak is a level-wide hunt trigger, not a lure`);
    assert(G.leakPower > 0,
      'the open risers went silent');
    console.log(`  ${G.leaksOpen} open risers at ${G.leakPower.toFixed(2)} each = `+
      `${(G.leakPower*G.leaksOpen).toFixed(2)} total, against a LOUD of ${A.LOUD} — always a lure`);
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
   completing twice. Each of those makes the mechanic free or broken. With
   several risers on a level there are two more: sealing the one you are at
   while another is still open, and double-counting the tallies. */
console.log('[16] the repair — five seconds, standing still');
{
  const W=76;

  /* --- placing the player ON a pipe, without fighting unstick() ---
     WHICH pipe is the argument: every assertion below is about a single riser,
     and on a four-riser level the interesting question is whether the game seals
     the one you are standing at and leaves the rest alone. */
  const firstOpen = () => G.leaks.find(L=>!L.fixed);
  const standAt = (L) => {
    const r = L || firstOpen();
    G.player.x = r.sx+0.5; G.player.y = r.sy+0.5;
    return r;
  };

  /* --- the spot exists and is in reach --- */
  buildFloor(1, 77777);
  const L0 = standAt();
  assert(A.leakReach(G.player.x, G.player.y),
    'standing on the pipe does not put you in repair reach');
  assert(A.leakReach(L0.sx+0.5, L0.sy+0.5),
    'the centre of the repair spot is not in reach');
  /* and it must NOT be in reach from across the room, or the repair is a
     proximity accident rather than a decision */
  assert(!A.leakReach(L0.sx+0.5 + A.REPAIR_REACH + 0.5, L0.sy+0.5),
    'you can wrench the pipe from outside the reach radius');

  /* --- holding still fills the bar, and it takes the stated five seconds --- */
  {
    /* Pinned to ONE riser. The loop deliberately does not hop to the next open
       pipe when this one seals — that is a different test (below), and a loop
       that retargets mid-hold silently measures the whole level's work and
       calls it one repair. */
    standAt(L0);
    keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
    let frames=0, t=0;
    while (L0.repair < A.REPAIR_TIME && !L0.fixed && frames < 4000){
      G.player.x = L0.sx+0.5; G.player.y = L0.sy+0.5;
      update(1/60); t += 1/60; frames++;
    }
    const sealed = G.leaks.filter(l=>l.fixed);
    assert(L0.fixed, `held still for ${t.toFixed(1)}s and the pipe never sealed`);
    assert(sealed.length===1, `${sealed.length} risers sealed from one hold — it took the lot at once`);
    assert(sealed[0]===L0, 'the riser that sealed was not the one the player was standing at');
    /* exactly the stated time, within a frame — a bar that fills early is a
       bar that was not asking for anything */
    assert(Math.abs(t - A.REPAIR_TIME) < 0.06,
      `the repair took ${t.toFixed(2)}s, want ${A.REPAIR_TIME}s`);
    console.log(`  held still: one riser sealed in ${t.toFixed(2)}s (stated ${A.REPAIR_TIME}s), `+
      `${G.leaksOpen} still open`);
  }

  /* --- exactly once: repairing a sealed pipe does nothing --- */
  {
    assert(L0.fixed===true, 'the pipe did not stay sealed');
    const before = G.stat.sealed;
    const openBefore = G.leaksOpen;
    standAt(L0);
    for (let i=0;i<600;i++){
      G.player.x = L0.sx+0.5; G.player.y = L0.sy+0.5;
      update(1/60);
    }
    assert(L0.repair===0, `a sealed pipe still has ${L0.repair}s of progress on it`);
    assert(G.stat.sealed===before, `sealLeak ran ${G.stat.sealed-before} extra times`);
    assert(G.leaksOpen===openBefore, 'standing on a sealed riser changed the open count');
    /* the others are still going, so the floor is still making noise */
    assert(G.leakPower>0, 'every riser went quiet while some were still open');
    console.log('  a sealed riser cannot be re-wrenched; the open ones keep dripping');
  }

  /* --- MOVING decays the bar, and does not reset it to zero --- */
  {
    buildFloor(1, 31415);
    const L = standAt();
    for (let i=0;i<180;i++){
      G.player.x = L.sx+0.5; G.player.y = L.sy+0.5;
      update(1/60);
    }
    const partial = L.repair;
    assert(partial > 0.5 && partial < A.REPAIR_TIME, `progress after 3s is ${partial}`);
    // now walk away
    L.repair = 3.0;
    for (let i=0;i<30;i++){ keys['d']=true; update(1/60); }
    keys['d']=false;
    assert(L.repair < 3.0,
      `walking off the pipe did not decay the bar (still ${L.repair})`);
    console.log(`  leaving after 3s decays to ${L.repair.toFixed(2)} — the mistake costs`);
  }

  /* --- and the bar decays to ZERO within a second, so hesitating is not a
         strategy --- */
  {
    const L = firstOpen();
    L.repair = A.REPAIR_TIME;
    for (let i=0;i<120;i++) update(1/60);      // 2s of standing somewhere else
    assert(L.repair===0, `the bar is still at ${L.repair} after 2s away`);
    console.log('  a full bar is lost in under two seconds away from the pipe');
  }

  /* --- the wrench is LOUD, and loud enough to wake a sleeping coil --- */
  {
    /* Level 5, because that is the level with four things in it — the assertion
       below needs a dormant one, and level 1 has a single walker. */
    buildFloor(A.LEVELS_N-1, 5150);
    const L = standAt();
    /* a dormant agent placed right next to the pipe must WAKE from the repair
       alone — the whole tension of the mechanic is that standing still
       announces you, so this asserts the announcement is real. */
    const sleeper = G.agents.find(a=>a.state==='DORMANT');
    assert(sleeper, 'level 5 has no dormant Lifeform to wake — the tension cannot exist');
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

  /* --- the door is sealed until EVERY riser is ---
     With four bursts on a level this is the rule that matters most and the one
     most easily half-implemented: "the door is shut" can mean "no riser is
     sealed" (wrong), "the riser you last touched is sealed" (wrong), or "all of
     them are" (right). The middle one is the bug that lets a player walk out
     on a level they have left three-quarters flooded, and it is invisible until
     you test it deliberately. */
  {
    buildFloor(3, 24680);          // level 4: four risers
    assert(G.leaks.length===4, `expected 4 risers on level 4, got ${G.leaks.length}`);
    /* nextFloor() increments a global, and this file is not at floor 0 by now.
       The question is "did the level end", so the baseline is where it started. */
    const f0 = A.floorIdx;
    const door = G.exitTiles[0];
    const atDoor = ()=>{ G.player.x = door.x+0.5; G.player.y = door.y+0.5; };
    const others = G.leaks.slice(0, G.leaks.length-1);

    /* Sitting on the door with the work undone: nothing happens, however long
       the player is willing to stand there. */
    atDoor();
    for (let i=0;i<400;i++){ G.batt=100; update(1/60); }
    assert(A.floorIdx===f0,
      `descended with risers open — the door is supposed to stay shut (floorIdx ${A.floorIdx})`);
    assert(G.descend===0, `the door cycled ${G.descend.toFixed(2)}s with risers open`);

    /* Seal all but the last, one at a time, and try the door after EACH. This is
       the case the old three-exit rule could not even express. */
    for (const L of others){
      A.sealLeak(L);
      atDoor();
      for (let i=0;i<200;i++){ G.batt=100; update(1/60); }
      assert(A.floorIdx===f0,
        `descended with ${G.leaksOpen} riser(s) still open — the gate is not "all of them"`);
      assert(G.descend===0, `the door cycled ${G.descend.toFixed(2)}s with ${G.leaksOpen} open`);
    }
    console.log(`  door stays sealed through all ${others.length} partial repairs`);

    /* and only the last one opens it, which proves the gate is the risers and
       not some side effect of the loop above */
    const last = G.leaks[G.leaks.length-1];
    A.sealLeak(last);
    atDoor();
    let opened=false;
    for (let i=0;i<200 && !opened;i++){
      G.batt=100; update(1/60);
      if (A.floorIdx>f0) opened=true;
    }
    assert(opened, 'with every riser sealed the door never opened — the gate is not the risers');
    console.log('  sealing the LAST riser opens the door');
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

  /* --- and the trail LEADS: wetness is strictly higher nearer the pipes --- */
  {
    const d0 = A.waterDist[G.leaks[0].sy*W+G.leaks[0].sx];
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

/* ============ TEST 18: a level is FINISHABLE, risers and all =========
   The whole level is one objective set — every riser, then the door — so it
   has to be inside the completion path the end-to-end bot already walks. This
   drives the bot at one riser, then the next, then the door it came in by, and
   asserts the level actually completes through the real update() with real key
   state. Level 5 is the one that matters: four risers is where a placement bug
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
    vm.runInContext('floorIdx=0; lives=3;', ctxObj);
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
      const wp=path[Math.min(wi,path.length-1)];
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
    if (process.env.V) console.log(`     level ${s}: ${frames} frames, ${sealedThisLevel} risers, ${allSealed?'all sealed':'LEFT OPEN'}`);
  }
  keys.w=keys.s=keys.a=keys.d=false; keys.shift=false;
  assert(noPath===0, `${noPath} legs had no path — the objective is unreachable`);
  assert(arrived===A.LEVELS_N, `the bot sealed every riser on ${arrived}/${A.LEVELS_N} levels`);
  assert(risersSealed===risersWanted,
    `${risersSealed}/${risersWanted} risers were sealed — the tallies do not agree`);
  assert(descended===A.LEVELS_N, `the bot walked back out on ${descended}/${A.LEVELS_N} levels`);
  console.log(`  bot: ${risersSealed} risers sealed, ${descended}/${A.LEVELS_N} levels walked back out`);
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
  assert(A.maskArr[L.y*W+L.x] > 0.9,
    `the pipe tile is masked to ${A.maskArr[L.y*W+L.x]} while the player stands on it`);

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
    A.setOption('difficulty','brutal');
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
    assert(A.SETTINGS.difficulty==='brutal', 'difficulty did not survive the round trip');
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
    A.setOption('difficulty','brutal');
    assert(A.SETTINGS.difficulty==='brutal', 'setOption did not take effect');
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
    A.setOption('difficulty','brutal');
    assert(A.FLOOR_CLOCK===A.DIFFICULTIES.brutal.clock, `the clock is ${A.FLOOR_CLOCK}s, want ${A.DIFFICULTIES.brutal.clock}s`);
    assert(A.REPAIR_TIME===A.DIFFICULTIES.brutal.repairTime, 'REPAIR_TIME did not follow the preset');
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
  const want = [[1,1],[2,1],[3,2],[4,3],[4,4]];
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
    assert(G.leaks.length===A.LEVELS[f].leaks, `built level ${f+1} has ${G.leaks.length} risers`);
    assert(G.agents.length===A.LEVELS[f].forms, `built level ${f+1} has ${G.agents.length} lifeforms`);
    assert(G.exitTiles.length===1, `built level ${f+1} has ${G.exitTiles.length} doors`);
    assert(G.clock===180, `level ${f+1} opens with ${G.clock}s, want 180`);
  }
  console.log('  every built level matches its row and opens on 3:00');

  /* --- the clock counts down, and only down --- */
  {
    buildFloor(0, 4242);
    A.STATE='play';
    vm.runInContext('lives=3;', ctxObj);
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
    vm.runInContext('lives=3; floorIdx=0;', ctxObj);
    G.clock = 0.5;
    A.updateReal(1);
    assert(A.STATE!=='play', 'the clock ran out and nothing happened');
    const sub = els['dead-sub'].textContent;
    assert(/CLOCK/.test(sub), `running out of time said "${sub}"`);
    assert(vm.runInContext('lives',ctxObj)===2, 'running out of time cost no life');
    /* and it is announced before it is fatal, so the last thirty seconds are
       the player's to spend rather than a surprise */
    buildFloor(0, 4242);
    A.STATE='play';
    vm.runInContext('lives=3;', ctxObj);
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
  {
    /* measured, not asserted from the constant: 20 seconds of play must not
       move the waterline more than a few tiles. */
    buildFloor(0, 6161);
    const wet0 = A.wetArr.reduce((a,b)=>a+(b>0.5?1:0),0);
    A.updateReal(20);
    const wet1 = A.wetArr.reduce((a,b)=>a+(b>0.5?1:0),0);
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
                 '_ambStart','_ambTick','_ambStop','_ambNote'];
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
  const html = fs.readFileSync(__dirname+'/index.html',  'utf8');
  const css  = fs.readFileSync(__dirname+'/style.css',   'utf8');
  const hudHtml = html.slice(html.indexOf('<div id="hud">'), html.indexOf('id="prompt"'));

  /* --- one column, not two clusters --------------------------------- */
  assert(/class="hud-side"/.test(hudHtml), 'the HUD has no .hud-side column');
  assert(!/hud-left|hud-right/.test(hudHtml),
    'the two top-edge clusters are still wired up — every stat should share one column');
  assert((hudHtml.match(/class="stat/g)||[]).length === 8,
    `expected 8 stats in the column, found ${(hudHtml.match(/class="stat/g)||[]).length}`);
  /* Grouped by KIND: clock alone, the three gauges, the three states, lives. */
  assert((hudHtml.match(/class="hud-div"/g)||[]).length === 3,
    'the column is not divided into its four groups');

  /* --- the column is pinned to ONE EDGE, full height ------------------
     WHICH edge is deliberately not asserted. It used to say "right", and when
     the column moved left that assertion failed and told you nothing except that
     the author had changed his mind — which is exactly what a test should never
     report as a defect. What has to hold is the SHAPE: one edge, top to bottom.
     An inset that pins only the top is a panel floating in a corner.

     So the edge is read out of the stylesheet and then everything else is
     checked relative to it. That also buys a real assertion for free — the
     plate's rule and its fade have to point at the play area, and that is only
     checkable if you know which edge the column is on. */
  const hudRule = css.match(/#hud\s*\{([^}]*)\}/);
  assert(hudRule, 'no #hud rule');
  const inset = ((hudRule[1].match(/inset\s*:\s*([^;]+)/)||[])[1]||'').trim().replace(/\s+/g,' ');
  const onLeft  = /^0\s+auto\s+0\s+0$/.test(inset);
  const onRight = /^0\s+0\s+0\s+auto$/.test(inset);
  assert(onLeft || onRight,
    `#hud is not pinned to one edge full-height (inset: ${inset}) — a sidebar needs an edge to sit on and the full height`);
  assert(/--side-w/.test(hudRule[1]), '#hud has no width — a sidebar needs one');
  assert(/z-index/.test(hudRule[1]),
    '#hud has no stacking level — anything painted later covers it silently');
  assert(/pointer-events\s*:\s*none/.test(hudRule[1]),
    '#hud swallows clicks — the game underneath must still be playable');

  /* --- and the plate presents itself to the PLAY area, not the bezel ---
     Both halves of this were left pointing the wrong way when the column moved
     from the right edge to the left, and neither is merely cosmetic:

       - a gradient that fades to transparent AT THE WINDOW EDGE and stays
         opaque in the middle means the world stops being readable ~130px before
         it is actually covered. You cannot tell where the blind spot starts,
         which is the specific thing an opaque overlay is supposed to guarantee.
       - a border on the window side separates nothing. The one crisp edge has
         to be the edge the player is reading against. */
  const sideRule = css.match(/\.hud-side\s*\{([^}]*)\}/);
  assert(sideRule, 'no .hud-side rule');
  const wantBorder = onLeft ? 'border-right' : 'border-left';
  const wantDeg    = onLeft ? '90deg'    : '270deg';
  assert(new RegExp('linear-gradient\\(\\s*'+wantDeg).test(sideRule[1]),
    `.hud-side does not fade with ${wantDeg} — on the ${onLeft?'left':'right'} that means solid at the window edge and fading out over the play area, so the boundary of the blind spot is where it looks like it is`);

  /* --- and it does NOT reserve canvas -------------------------------
     This is the assertion that would have caught the old 150px sidebar, and it
     is a genuine gameplay bug rather than a style one: reserved canvas is play
     area you cannot see or be seen in, on the side things approach from. */
  const gameRule = css.match(/#game\s*\{([^}]*)\}/);
  assert(gameRule, 'no #game rule');
  assert(!/right\s*:\s*\d+px/.test(gameRule[1]),
    '#game reserves a pixel strip of play area for the HUD');
  assert(/inset\s*:\s*0/.test(gameRule[1]) || /width\s*:\s*100%/.test(gameRule[1]),
    '#game is not the whole window');

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
  for (const key of ['WASD','SHIFT','ENTER','ESC']){
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

  /* --- M, on the real key handler, in every state ---
     It is the one control with no button, so the key path IS the feature: a
     hotkey that is wired to the wrong state, or that fires on auto-repeat, or
     that also advances the splash, is a hotkey that does not work. */
  const mutedAt = ()=> vm.runInContext('SETTINGS.muted', ctxObj);
  const storeAt = ()=> JSON.parse(global.__store.get(A.SETTINGS_KEY) || '{}');
  const stored = ()=> {
    A.saveSettings();
    const s = storeAt();
    A.loadSettings();
    return s;
  };
  for (const st of ['splash','order','pause','dead','win','settings']){
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
  const html = fs.readFileSync(__dirname+'/index.html','utf8');
  const css  = fs.readFileSync(__dirname+'/style.css','utf8');
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
  const html = fs.readFileSync(__dirname+'/index.html','utf8');
  const splash = html.slice(html.indexOf('id="screen-splash"'));
  const order  = html.slice(html.indexOf('id="screen-order"'),  html.indexOf('id="screen-pause"'));
  const pause  = html.slice(html.indexOf('id="screen-pause"'),   html.indexOf('id="screen-dead"'));
  assert(pause.length>0, 'the pause screen is missing from index.html');

  /* --- same furniture --- */
  assert(/class="order perf"/.test(pause), 'the pause screen is not the ticket');
  assert(!/class="tape"/.test(pause), 'the pause screen still has its own layout');
  assert(/id="btn-settings-pause"/.test(pause), 'the pause screen has no link to settings');
  /* the settings link sits BELOW the ticket, not inside it */
  assert(pause.indexOf('id="btn-settings-pause"') > pause.indexOf('class="order perf"'),
    'the settings link is inside the ticket instead of under it');

  /* --- the same controls, in the same place: the stub, under CONTROLS --- */
  const ctrlBlock = (s)=>{ const m = s.match(/<small>CONTROLS<\/small>([\s\S]*?)<\/div>\s*<\/p>/); return m?m[1]:''; };
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
  /* ENTER is the splash's confirm key and has no job on the pause ticket — it
     is not the resume key there, ESC is, and a key listed as doing something it
     does not do is worse than a key missing from a list. */
  assert(!has(pk, 'ENTER'), 'the pause ticket still lists ENTER, which resumes nothing');
  for (const k of ok.filter(x=>!x.toUpperCase().includes('ENTER'))){
    assert(has(pk, k), `the pause ticket dropped ${k}, which the splash lists`);
  }

  /* --- and the numbers are the run's --- */
  buildFloor(2, 9090);
  G.leaksOpen = G.risers; G.floodCover = 0.31; G.batt = 42; G.stat.noises = 7;
  A.STATE = 'play';
  A.togglePause();
  assert(A.STATE==='pause', 'ESC did not pause');
  const txt = id=> els[id] ? els[id].innerHTML : '';
  assert(/3 \/ /.test(txt('pause-level')), `depth reads "${txt('pause-level')}" on level 3`);
  assert(txt('pause-risers').includes('0/'), `the riser tally reads "${txt('pause-risers')}"`);
  assert(txt('pause-batt')==='42', `battery reads "${txt('pause-batt')}", expected 42`);
  assert(/^#88D-[0-9A-F]{1,4}$/.test(txt('pause-seed')), `the ticket seed reads "${txt('pause-seed')}"`);
  assert(txt('pause-clock')===A.clockText(G.clock), 'the clock on the ticket is not the clock in state');
  assert(/7<\/b> noise/.test(txt('pause-hint')), 'the status line does not report what the run has heard');

  /* the life pips are spent ones included — the count the HUD has been showing */
  A.lives = Math.max(1, A.runLives-1);
  A.STATE='play'; A.togglePause();
  assert(/gone/.test(txt('pause-lives')), 'a spent life is not drawn as spent on the ticket');
  A.lives = A.runLives;

  /* the scope line answers a different question than the status line */
  assert(txt('pause-scope').length>0, 'the scope of work was left blank');
  assert(txt('pause-scope')!==txt('pause-hint'), 'scope and status are the same sentence');

  /* and once everything is sealed, the scope line says so instead of stalling */
  G.leaksOpen = 0;
  A.STATE='play'; A.togglePause();
  assert(/threshold/i.test(txt('pause-scope')), 'with every riser sealed the ticket still asks for sealing');

  A.STATE='play'; A.hideAll();
  console.log('  pause = the work order, live numbers, controls intact, settings below');
}

/* ============ TEST 27: the four removed settings are gone, and stay gone
   Settings that only had their widgets deleted would still be readable from a
   stale localStorage blob, still settable through the API, and still rendered
   by a branch nobody remembers writing. All four have to be absent from the
   schema, the store, the markup, and the renderer. */
console.log('[27] the removed settings — frame counter, flicker, tape, shake');
{
  const html = fs.readFileSync(__dirname+'/index.html','utf8');
  const css  = fs.readFileSync(__dirname+'/style.css','utf8');
  const src  = fs.readFileSync(__dirname+'/game.js','utf8');
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
  const src = fs.readFileSync(__dirname+'/game.js','utf8');
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

  const html = fs.readFileSync(__dirname+'/index.html','utf8');
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

reportTimings();
console.log('\n' + (fail? `\n${fail} FAILURE(S)\n` : 'ALL TESTS PASSED\n'));
process.exit(fail?1:0);