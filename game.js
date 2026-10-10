/* ============================================================
   THE BACKROOMS
   2D top-down puzzle / stealth. JS + canvas only, no assets.

   Design contract:
   - The torch is INFORMATION ONLY. It reveals exits + scrawled
     warnings. It never repels, never lies to the monster.
   - The maze is lit by humming fluorescents in mono-yellow.
     Always visible. That visibility is the horror.
   - Noise is the entire stealth layer. Sprinting is fast and fatal.
   - The Lifeform: coiled black wire. Dormant = a pile of loops.
     It RISES when it hears you. That 1.4s animation is your window.
   ============================================================ */

/* ---------- deterministic RNG ---------- */
function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- tuning ---------- */
const TILE   = 40;
const LS     = 4;                 // light samples per tile
const MAP_W  = 76;
const MAP_H  = 76;
const VIEW_T = 27;                // tiles across the viewport
const FLOORS = 5;

const WALK   = 3.3;               // tiles/sec
const SPRINT = 6.0;
const R      = 0.33;              // player collision radius (tiles)

const BATT_MAX   = 100;
const BATT_DRAIN = 2.4;           // per second while lit
const EXIT_COUNT = 3;

const WALL = 0, FLOOR = 1;

/* ---------- canvas ---------- */
const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d', { alpha:false });
let VW = 0, VH = 0, DPR = 1, SCALE = 1;

function resize(){
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = cvs.clientWidth; VH = cvs.clientHeight;
  cvs.width = Math.floor(VW * DPR);
  cvs.height = Math.floor(VH * DPR);
  SCALE = cvs.width / (VIEW_T * TILE);
}
window.addEventListener('resize', resize);

/* ============================================================
   AUDIO — synthesized, deliberately minimal.
   fluorescent hum, wet carpet footsteps, proximity drone, hiss
   ============================================================ */
const Audio_ = {
  ctx:null, ok:false,
  hum:null, humGain:null,
  hiss:null, hissGain:null,
  drone:null, droneGain:null, droneFilter:null,

  init(){
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const a = this.ctx;

    // 2s white-noise buffer, reused for hiss / steps / sting
    const len = a.sampleRate * 2;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
    this.noise = buf;

    // --- 60Hz fluorescent hum + its 2nd/3rd harmonics ---
    this.humGain = a.createGain();
    this.humGain.gain.value = 0.055;
    this.humGain.connect(a.destination);
    [[60,0.55],[120,0.3],[180,0.12]].forEach(([f,g])=>{
      const o = a.createOscillator(); o.type='sine'; o.frequency.value=f;
      const gg = a.createGain(); gg.gain.value=g;
      o.connect(gg); gg.connect(this.humGain); o.start();
    });

    // --- tape hiss ---
    this.hissGain = a.createGain();
    this.hissGain.gain.value = 0.012;
    const hp = a.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=3800;
    const hs = a.createBufferSource(); hs.buffer=buf; hs.loop=true;
    hs.connect(hp); hp.connect(this.hissGain); this.hissGain.connect(a.destination);
    hs.start();

    // --- proximity drone (Lifeform) ---
    this.droneGain = a.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter = a.createBiquadFilter();
    this.droneFilter.type='lowpass'; this.droneFilter.frequency.value=180;
    this.droneGain.connect(this.droneFilter); this.droneFilter.connect(a.destination);
    const o1=a.createOscillator(); o1.type='sawtooth'; o1.frequency.value=41;
    const o2=a.createOscillator(); o2.type='sine';     o2.frequency.value=55.5;
    const g2=a.createGain(); g2.gain.value=0.6;
    o1.connect(this.droneGain); o2.connect(g2); g2.connect(this.droneGain);
    o1.start(); o2.start();

    this.ok = true;
  },

  step(vol){                       // wet carpet footstep
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const s=a.createBufferSource(); s.buffer=this.noise;
    s.playbackRate.value = 0.7 + Math.random()*0.4;
    const f=a.createBiquadFilter(); f.type='lowpass'; f.frequency.value=520;
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.10*vol, t+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.17);
    s.connect(f); f.connect(g); g.connect(a.destination);
    s.start(t); s.stop(t+0.2);
  },

  rattle(vol){                     // wire shifting
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    for(let i=0;i<5;i++){
      const s=a.createBufferSource(); s.buffer=this.noise;
      s.playbackRate.value = 1.4 + Math.random();
      const f=a.createBiquadFilter(); f.type='bandpass';
      f.frequency.value = 1400+Math.random()*2600; f.Q.value=7;
      const g=a.createGain();
      const st=t+i*0.045+Math.random()*0.02;
      g.gain.setValueAtTime(0.0001,st);
      g.gain.exponentialRampToValueAtTime(0.05*vol, st+0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, st+0.07);
      s.connect(f); f.connect(g); g.connect(a.destination);
      s.start(st); s.stop(st+0.09);
    }
  },

  sting(){                         // caught
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const s=a.createBufferSource(); s.buffer=this.noise;
    const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.setValueAtTime(5200,t);
    f.frequency.exponentialRampToValueAtTime(90,t+1.3);
    const g=a.createGain();
    g.gain.setValueAtTime(0.32,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+1.5);
    s.connect(f); f.connect(g); g.connect(a.destination);
    s.start(t); s.stop(t+1.6);
  },

  door(){                          // heavy exit cycling open
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const o=a.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(70,t);
    o.frequency.exponentialRampToValueAtTime(28,t+1.1);
    const f=a.createBiquadFilter(); f.type='lowpass'; f.frequency.value=420;
    const g=a.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.16,t+0.08);
    g.gain.exponentialRampToValueAtTime(0.0001,t+1.2);
    o.connect(f); f.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t+1.3);
  },

  drone(level, dist){
    if (!this.ok) return;
    const a=this.ctx, t=a.currentTime;
    const g = level * 0.16;
    this.droneGain.gain.setTargetAtTime(g, t, 0.35);
    this.droneFilter.frequency.setTargetAtTime(140 + (1-level)*40 + 90*level, t, 0.4);
  },
  silence(){ if (this.ok) this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); }
};

/* ============================================================
   TEXTURE PATTERNS — carpet speckle + wallpaper
   ============================================================ */
function hash2(x,y){ let h = x*374761393 + y*668265263; h = (h ^ (h>>13))*1274126177; return ((h ^ (h>>16))>>>0)/4294967296; }

let carpetPat, wallPat, ceilPat, scanPat, grainCv;

function buildPatterns(){
  // --- carpet: 64x64 speckled beige, seamless-ish ---
  let c = document.createElement('canvas'); c.width=c.height=64;
  let g = c.getContext('2d');
  g.fillStyle='#b3a469'; g.fillRect(0,0,64,64);
  for(let i=0;i<2600;i++){
    const x=Math.random()*64, y=Math.random()*64;
    const v = Math.random();
    g.fillStyle = v<0.4 ? 'rgba(90,82,44,0.30)' : 'rgba(214,203,148,0.28)';
    g.fillRect(x,y,1.6,1.6);
  }
  for(let i=0;i<260;i++){           // faint tile seams
    g.fillStyle='rgba(70,63,34,0.14)';
    g.fillRect(Math.random()*64|0, Math.random()*64|0, 2,2);
  }
  carpetPat = ctx.createPattern(c,'repeat');

  // --- wallpaper on wall faces: vertical dotted motif ---
  c = document.createElement('canvas'); c.width=32; c.height=48;
  g = c.getContext('2d');
  const grd = g.createLinearGradient(0,0,0,48);
  grd.addColorStop(0,'#b9ac6a'); grd.addColorStop(0.55,'#cfc079'); grd.addColorStop(1,'#7d7442');
  g.fillStyle=grd; g.fillRect(0,0,32,48);
  g.fillStyle='rgba(120,110,58,0.55)';
  for(let y=6;y<48;y+=11) for(let x=(y/11|0)%2?4:12;x<32;x+=8) g.fillRect(x,y,2,2);
  g.fillStyle='rgba(232,220,150,0.16)'; g.fillRect(0,0,32,3);
  wallPat = ctx.createPattern(c,'repeat');

  // --- wall top (seen from above) ---
  c = document.createElement('canvas'); c.width=c.height=24;
  g = c.getContext('2d');
  g.fillStyle='#8c8249'; g.fillRect(0,0,24,24);
  for(let i=0;i<420;i++){
    g.fillStyle = Math.random()<0.5?'rgba(60,55,28,0.25)':'rgba(180,170,110,0.20)';
    g.fillRect(Math.random()*24, Math.random()*24, 2,2);
  }
  ceilPat = ctx.createPattern(c,'repeat');

  // --- VHS scanlines ---
  c = document.createElement('canvas'); c.width=1; c.height=4;
  g = c.getContext('2d');
  g.fillStyle='rgba(0,0,0,0)'; g.fillRect(0,0,1,3);
  g.fillStyle='rgba(0,0,0,0.85)'; g.fillRect(0,3,1,1);
  scanPat = ctx.createPattern(c,'repeat');

  // --- grain ---
  grainCv = document.createElement('canvas'); grainCv.width=grainCv.height=160;
  g = grainCv.getContext('2d');
  const im = g.createImageData(160,160);
  for(let i=0;i<im.data.length;i+=4){
    const v = 118 + (Math.random()*74|0);
    im.data[i]=im.data[i+1]=im.data[i+2]=v; im.data[i+3]=255;
  }
  g.putImageData(im,0,0);
}

/* ============================================================
   MAZE — BSP room segmentation. "randomly segmented empty rooms"
   ============================================================ */
function genMaze(rng){
  const grid = new Uint8Array(MAP_W*MAP_H);       // 0 everywhere = solid
  const rooms = [];
  const doors = [];
  const idx = (x,y)=> y*MAP_W + x;

  const leaves = [];
  (function split(x,y,w,h,depth){
    const MIN = 15;
    const tooSmall = (w < MIN*2 && h < MIN*2);
    if (depth <= 0 || tooSmall){
      leaves.push({x,y,w,h,id:leaves.length});
      return;
    }
    const horiz = h > w ? true : (w > h ? false : rng() < 0.5);
    if (horiz){
      if (h < MIN*2){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      const cut = MIN + Math.floor(rng()*(h - MIN*2 + 1));
      split(x, y,      w, cut, depth-1);
      split(x, y + cut, w, h - cut, depth-1);
      const px = x + 2 + Math.floor(rng()*(w-4));
      doors.push([px, y+cut-1, px, y+cut]);
    } else {
      if (w < MIN*2){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      const cut = MIN + Math.floor(rng()*(w - MIN*2 + 1));
      split(x,      y, cut, h, depth-1);
      split(x + cut, y, w - cut, h, depth-1);
      const py = y + 2 + Math.floor(rng()*(h-4));
      doors.push([x+cut-1, py, x+cut, py]);
    }
  })(1,1,MAP_W-2,MAP_H-2,4);

  // carve each leaf as a room, inset unevenly (fake partition walls)
  for (const L of leaves){
    const ix1 = 1 + Math.floor(rng()*3);
    const iy1 = 1 + Math.floor(rng()*3);
    const ix2 = 1 + Math.floor(rng()*3);
    const iy2 = 1 + Math.floor(rng()*3);
    const rx = L.x+ix1, ry = L.y+iy1;
    const rw = Math.max(5, L.w-ix1-ix2);
    const rh = Math.max(5, L.h-iy1-iy2);
    for (let y=ry; y<ry+rh; y++)
      for (let x=rx; x<rx+rw; x++) grid[idx(x,y)] = FLOOR;
    L.rx=rx; L.ry=ry; L.rw=rw; L.rh=rh;
    rooms.push(L);
  }

  /* Punch doorways through the partition bands.
     The band between two rooms is up to 6 tiles thick, so a 2-tile
     punch would dead-end inside the wall. Instead, tunnel along the
     door column in both directions until we actually break into a
     room floor on each side. */
  for (const [px, rowA, , rowB] of doors){
    for (let y=rowA, guard=0; guard<10; y--, guard++){          // upward
      if (y<0) break;
      grid[idx(px,y)] = FLOOR;
      if (grid[idx(px,y-1)]===FLOOR) break;
    }
    for (let y=rowB, guard=0; guard<10; y++, guard++){          // downward
      if (y>=MAP_H-1) break;
      grid[idx(px,y)] = FLOOR;
      if (grid[idx(px,y+1)]===FLOOR) break;
    }
  }

  /* --- guarantee a single connected region ---
     Belt and braces: flood fill from the biggest room, then tunnel
     from any orphaned region straight into the main one until the
     whole floor is one component. */
  const label = new Int32Array(MAP_W*MAP_H).fill(-1);
  const comps = [];
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i0 = idx(x,y);
    if (grid[i0]!==FLOOR || label[i0]>=0) continue;
    const cid = comps.length, stack=[i0], cells=[];
    label[i0]=cid;
    while(stack.length){
      const c = stack.pop(); cells.push(c);
      const cx=c%MAP_W, cy=(c/MAP_W)|0;
      const nb=[c+1,c-1,c+MAP_W,c-MAP_W];
      const ok=[cx<MAP_W-1, cx>0, cy<MAP_H-1, cy>0];
      for(let k=0;k<4;k++){
        if(!ok[k]) continue;
        const ni=nb[k];
        if(grid[ni]===FLOOR && label[ni]<0){ label[ni]=cid; stack.push(ni); }
      }
    }
    comps.push(cells);
  }
  if (comps.length > 1){
    let main=0;
    for (let c=1;c<comps.length;c++) if (comps[c].length>comps[main].length) main=c;
    const inMain = new Uint8Array(MAP_W*MAP_H);
    for (const c of comps[main]) inMain[c]=1;
    for (let cid=0; cid<comps.length; cid++){
      if (cid===main) continue;
      for (const c of comps[cid]){
        if (inMain[c]) continue;
        const cx=c%MAP_W, cy=(c/MAP_W)|0;
        // find the closest already-connected tile
        let best=null, bd=1e9;
        for (const m of comps[main]){
          const mx=m%MAP_W, my=(m/MAP_W)|0;
          const d=(mx-cx)**2+(my-cy)**2;
          if (d<bd){ bd=d; best=[mx,my]; }
          if (bd<=4) break;
        }
        if (!best) continue;
        // L-shaped tunnel from (cx,cy) to best
        let x=cx, y=cy;
        while (x!==best[0]){ grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1; x+=Math.sign(best[0]-x); }
        while (y!==best[1]){ grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1; y+=Math.sign(best[1]-y); }
        grid[idx(x,y)]=FLOOR; inMain[idx(x,y)]=1;
      }
      // refresh main membership with everything we just joined
      for (const c of comps[cid]) if (inMain[c]) comps[main].push(c);
    }
  }

  return { grid, rooms, leaves };
}

/* ============================================================
   FLOOR STATE
   ============================================================ */
let G;                       // everything below belongs to one floor
let lightArr, lightCv;       // baked ambient light

function buildFloor(floorNum, seed){
  const rng = mulberry32(seed + floorNum*7919);
  const maze = genMaze(rng);
  const grid = maze.grid;
  const at = (x,y)=> grid[y*MAP_W+x];
  const inB = (x,y)=> x>=0 && y>=0 && x<MAP_W && y<MAP_H;

  /* --- line of sight (Bresenham, walls block) --- */
  function los(x0,y0,x1,y1){
    x0=Math.floor(x0); y0=Math.floor(y0); x1=Math.floor(x1); y1=Math.floor(y1);
    let dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
    let sx=x0<x1?1:-1, sy=y0<y1?1:-1, err=dx-dy;
    let guard=0;
    while(guard++ < 400){
      if(x0===x1 && y0===y1) return true;
      const e2 = 2*err;
      if (e2 > -dy){ err -= dy; x0 += sx; }
      if (e2 <  dx){ err += dx; y0 += sy; }
      if (x0===x1 && y0===y1) return true;
      if (!inB(x0,y0) || at(x0,y0)===WALL) return false;
    }
    return false;
  }

  /* --- pick 3 exits, greedily spread across the floor --- */
  const candidates = maze.rooms.filter(r=>r.rw>=8 && r.rh>=8);
  const pool = candidates.length>=6 ? candidates : maze.rooms;
  const exits = [];
  const entryRoom = pool[0];
  const first = pool.reduce((b,r)=>{
    const d0 = Math.hypot(r.rx+r.rw/2-entryRoom.rx-entryRoom.rw/2, r.ry+r.rh/2-entryRoom.ry-entryRoom.rh/2);
    return d0 > b.d ? {r,d:d0} : b;
  }, {r:pool[1]||pool[0], d:-1}).r;
  exits.push(first);
  while (exits.length < EXIT_COUNT && exits.length < pool.length){
    let best=null, bestD=-1;
    for (const r of pool){
      if (exits.includes(r)) continue;
      let mn=1e9;
      for (const e of exits){
        const d = Math.hypot(r.rx+r.rw/2-e.rx-e.rw/2, r.ry+r.rh/2-e.ry-e.rh/2);
        if (d<mn) mn=d;
      }
      if (mn>bestD){ bestD=mn; best=r; }
    }
    if (!best) break;
    exits.push(best);
  }

  /* --- each exit = an INTERIOR wall tile touching its room's floor.
         Must not land on the outer border: there the player's body can
         never get within the descend radius, which would make the floor
         unwinnable. --- */
  const exitTiles = [];
  const INTERIOR = (x,y)=> x>0 && y>0 && x<MAP_W-1 && y<MAP_H-1;
  for (const r of exits){
    const ring = [];
    for (let x=r.rx; x<r.rx+r.rw; x++){ ring.push([x,r.ry-1]); ring.push([x,r.ry+r.rh]); }
    for (let y=r.ry; y<r.ry+r.rh; y++){ ring.push([r.rx-1,y]); ring.push([r.rx+r.rw,y]); }
    const valid = ring.filter(([tx,ty]) =>
      INTERIOR(tx,ty) && at(tx,ty)===WALL &&
      (at(tx+1,ty)===FLOOR||at(tx-1,ty)===FLOOR||at(tx,ty+1)===FLOOR||at(tx,ty-1)===FLOOR));
    // prefer a tile that also touches this room's own floor (a real doorway)
    const own = valid.filter(([tx,ty]) =>
      (tx>=r.rx&&tx<r.rx+r.rw&&(ty===r.ry-1||ty===r.ry+r.h ||
        (ty>=r.ry&&ty<r.ry+r.rh&&(tx===r.rx-1||tx===r.rx+r.w)))));
    const pool2 = (own.length ? own : valid);
    if (!pool2.length) continue;
    const [bx,by] = pool2[(rng()*pool2.length)|0];
    exitTiles.push({x:bx, y:by, found:false, open:0, room:r});
  }

  /* --- fixtures: ~30% of rooms unlit, some with two panels --- */
  const fixtures = [];
  for (const r of maze.rooms){
    if (r.rw<4 || r.rh<4) continue;
    if (rng() < 0.18) continue;
    const n = (r.rw*r.rh > 260 && rng()<0.4) ? 2 : 1;
    for (let i=0;i<n;i++){
      // radius follows the room, so no room ends up a black hole
      const rad = Math.max(9, Math.min(19, Math.hypot(r.rw, r.rh)*0.62));
      fixtures.push({
        x: r.rx + 1 + rng()*(r.rw-2),
        y: r.ry + 1 + rng()*(r.rh-2),
        r: rad * (0.85 + rng()*0.3),
        i: 0.85 + rng()*0.2,
        flicker: rng() < 0.16 ? (0.5 + Math.random()*2.4) : 0,
        phase: rng()*Math.PI*2
      });
    }
  }

/* --- battery pickups ---
     One is GUARANTEED inside each exit room. Lighting an exit reveals the
     cell, so the battery needed to reach the NEXT exit is always sitting in
     the room you just lit. Without this the light budget is a coin-flip that
     can strand the player with a dead torch and unfound exits. */
  const batteries = [];
  const litRooms = maze.rooms.filter(r=>fixtures.some(f=>f.x>=r.rx&&f.x<=r.rx+r.rw&&f.y>=r.ry&&f.y<=r.ry+r.rh));
  for (const e of exitTiles){
    const r = e.room;
    if (!r || r.rw<5 || r.rh<5) continue;
    batteries.push({ x: r.rx+1+Math.floor(rng()*(r.rw-2)),
                     y: r.ry+1+Math.floor(rng()*(r.rh-2)), taken:false });
  }
  for (let i=0;i<6+floorNum*2;i++){
    const src = (rng()<0.6 && litRooms.length) ? litRooms : maze.rooms;
    const r = src[(rng()*src.length)|0];
    if (!r || r.rw<4||r.rh<4) continue;
    const x = r.rx+1+Math.floor(rng()*(r.rw-2));
    const y = r.ry+1+Math.floor(rng()*(r.rh-2));
    batteries.push({x,y,taken:false});
  }

  /* --- scrawled warnings on the carpet --- */
  const NOTES = [
    'it only hears you when you move',
    'the lights are always on. always on. always on.',
    'six hundred million square miles. i counted for a while.',
    'don\'t run. running is how it finds you.',
    'the torch only shows you the door. it can\'t close it.',
    'it was a pile of wire when i walked past it',
    'left foot. right foot. left foot. right fo',
    'you are not the first thing here to look for the exits',
    'if you can hear it, it already knows where you are',
    'the hum is not coming from the ceiling'
  ];
  const graffiti = [];
  for (let i=0;i<9+floorNum*2;i++){
    const r = maze.rooms[(rng()*maze.rooms.length)|0];
    if (!r || r.rw<5||r.rh<5) continue;
    const x = r.rx+1+Math.floor(rng()*(r.rw-2));
    const y = r.ry+1+Math.floor(rng()*(r.rh-2));
    graffiti.push({x,y,text:NOTES[(rng()*NOTES.length)|0],seen:false});
  }

  /* --- bake ambient light --- */
  lightArr = new Float32Array(MAP_W*MAP_H);
  for (const f of fixtures){
    const R2 = f.r*f.r;
    const x0=Math.max(0,Math.floor(f.x-f.r)), x1=Math.min(MAP_W-1,Math.ceil(f.x+f.r));
    const y0=Math.max(0,Math.floor(f.y-f.r)), y1=Math.min(MAP_H-1,Math.ceil(f.y+f.r));
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
      const d2=(x+0.5-f.x)**2 + (y+0.5-f.y)**2;
      if (d2>R2) continue;
      if (at(x,y)===WALL) continue;
      if (!los(f.x,f.y,x+0.5,y+0.5)) continue;
      const fall = 1 - Math.sqrt(d2)/f.r;
      const v = f.i * fall * fall * 2.1;
      const i0 = y*MAP_W+x;
      if (v > lightArr[i0]) lightArr[i0] = v;
    }
  }
  // 3x3 blur for soft falloff (a wider kernel dilutes single lit tiles
  // into nothing, which leaves the floor pitch black between fixtures)
  const tmp = new Float32Array(lightArr);
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    let s=0,n=0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
      const nx=x+dx, ny=y+dy;
      if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
      s+=tmp[ny*MAP_W+nx]; n++;
    }
    lightArr[y*MAP_W+x] = s/n;
  }
  // nothing is ever fully black — the fluorescents are always humming
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i=y*MAP_W+x;
    if (at(x,y)===FLOOR && lightArr[i] < 0.13) lightArr[i] = 0.13;
  }
  // walls catch light from adjacent floor (their face is visible)
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i=y*MAP_W+x;
    if (at(x,y)!==WALL) continue;
    let m=0;
    if (inB(x+1,y)&&at(x+1,y)===FLOOR) m=Math.max(m,tmp[i+1]);
    if (inB(x-1,y)&&at(x-1,y)===FLOOR) m=Math.max(m,tmp[i-1]);
    if (inB(x,y+1)&&at(x,y+1)===FLOOR) m=Math.max(m,tmp[i+MAP_W]);
    if (inB(x,y-1)&&at(x,y-1)===FLOOR) m=Math.max(m,tmp[i-MAP_W]);
    lightArr[i] = m*0.80;
  }

  // pack to an image (4 samples/tile, upscaled smoothly at draw time)
  lightCv = document.createElement('canvas');
  lightCv.width = MAP_W*LS; lightCv.height = MAP_H*LS;
  const lg = lightCv.getContext('2d');
  const im = lg.createImageData(lightCv.width, lightCv.height);
  for (let y=0;y<lightCv.height;y++){
    const ty = (y/LS)|0;
    for (let x=0;x<lightCv.width;x++){
      const tx = (x/LS)|0;
      const b = Math.min(1, lightArr[ty*MAP_W+tx]);
      const k = (y*lightCv.width+x)*4;
      im.data[k]   = Math.min(255, 255*b + 18);
      im.data[k+1] = Math.min(255, 246*b + 16);
      im.data[k+2] = Math.min(255, 186*b + 10);
      im.data[k+3] = 255;
    }
  }
  lg.putImageData(im,0,0);

  /* --- entities --- */
  const spawn = {
    x: entryRoom.rx + entryRoom.rw/2,
    y: entryRoom.ry + entryRoom.rh/2
  };
  // the hunter spawns as far from you as possible
  let far = null, fd = -1;
  for (const r of maze.rooms){
    const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
    const d = Math.hypot(cx-spawn.x, cy-spawn.y);
    if (d>fd){ fd=d; far=r; }
  }
  const agents = [{
    x: far.rx+far.rw/2, y: far.ry+far.rh/2,
    state:'WALK', t:0, rise:0, target:null, face:Math.random()*6.28,
    wakeCd:0, stepT:0, born:3.5
  }];
  // dormant coil piles
  for (let i=0;i<3+floorNum;i++){
    const r = maze.rooms[(rng()*maze.rooms.length)|0];
    if (!r || r.rw<5||r.rh<5) continue;
    agents.push({
      x: r.rx+1+Math.floor(rng()*(r.rw-2)),
      y: r.ry+1+Math.floor(rng()*(r.rh-2)),
      state:'DORMANT', t:0, rise:0, target:null, face:0,
      wakeCd:0, stepT:0, born:0
    });
  }

  G = {
    floor: floorNum,
    seed,
    grid, at, inB, los,
    rooms: maze.rooms,
    fixtures, batteries, graffiti, exitTiles,
    agents,
    player: { x: spawn.x, y: spawn.y, face:-Math.PI/2, stepT:0 },
    batt: BATT_MAX,
    torch: true,
    noise: 0, noisePeak: 0,
    exitsFound: 0,
    descend: 0,
    time: 0,
    seenBy: 0,
    nearest: 99,
    stat: { noises:0, found:0, deaths:0 }
  };
  HUD.exitsFound = 0;
}

/* NOTE: x/y here may be FRACTIONAL world coords (collision), so they MUST be
   floored before indexing the tile array. Without this, G.grid[y*MAP_W+x]
   is a fractional index -> undefined -> undefined===WALL is false -> walls
   become permeable at their edges. */
const solid = (x,y)=>{
  x = Math.floor(x); y = Math.floor(y);
  return !(x>=0 && y>=0 && x<MAP_W && y<MAP_H) || G.grid[y*MAP_W+x]===WALL;
};

/* Circle vs tile-AABB.
   A 8-point sample ring is close enough to a box that diagonal wall corners
   snag you even when a clear circular path exists — movement feels sticky.
   This is the exact test, and it lets you slide around corners smoothly. */
function blocked(x,y,r){
  const tx0=Math.floor(x-r), tx1=Math.floor(x+r);
  const ty0=Math.floor(y-r), ty1=Math.floor(y+r);
  for (let ty=ty0; ty<=ty1; ty++){
    for (let tx=tx0; tx<=tx1; tx++){
      if (!solid(tx,ty)) continue;
      const px = x < tx   ? tx : (x > tx+1 ? tx+1 : x);
      const py = y < ty   ? ty : (y > ty+1 ? ty+1 : y);
      const dx = x-px, dy = y-py;
      if (dx*dx + dy*dy < r*r) return true;
    }
  }
  return false;
}

/* Safety net: if an entity's circle is overlapping geometry, every direction
   is blocked and it is wedged for good. Slide it to the nearest free spot.
   Reached by axis-separated sliding into a wall edge, so it is rare — but a
   soft-lock you cannot walk out of is unacceptable. */
/* Slide out of geometry. `force` skips the "already legal" early-out and is
   used when an entity is legal but immobile (both axes blocked at once), which
   an overlap test alone cannot detect. Local only — never teleports. */
function unstick(e, force){
  if (!force && !blocked(e.x, e.y, 0.34)) return false;
  let bx=null, by=null, bd=Infinity;
  for (let a=0; a<24; a++){
    const ang = a/24*Math.PI*2;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d=0.08; d<=0.9; d+=0.08){
      const nx = e.x+cx*d, ny = e.y+cy*d;
      if (!blocked(nx, ny, 0.34)){ if (d<bd){ bd=d; bx=nx; by=ny; } break; }
    }
  }
  if (bx!==null){ e.x=bx; e.y=by; return true; }
  return false;
}

/* Move with CORNER ASSIST.
   A pure per-axis move snags whenever a wall ends in a corner: sliding left
   under a wall block is blocked by that block's bottom-left corner even though
   the lane is wide open. Nudging perpendicular lets you slip past the corner,
   which is what makes wall-sliding feel smooth instead of sticky. */
function moveEnt(e, dx, dy, r){
  const wantX = dx, wantY = dy;
  let movedX=false, movedY=false;

  if (dx!==0){
    if (!blocked(e.x+dx, e.y, r)){ e.x += dx; movedX=true; }
    else {
      for (const s of [1,-1]){
        const ny = e.y + s*0.30;
        if (!blocked(e.x+dx, ny, r)){ e.x += dx; e.y = ny; movedX=true; break; }
      }
    }
  }
  if (dy!==0){
    if (!blocked(e.x, e.y+dy, r)){ e.y += dy; movedY=true; }
    else {
      for (const s of [1,-1]){
        const nx = e.x + s*0.30;
        if (!blocked(nx, e.y+dy, r)){ e.x = nx; e.y += dy; movedY=true; break; }
      }
    }
  }

  /* A move was asked for and NOTHING happened: the entity is in a pocket that
     is technically legal but has no escape (both axes blocked at once).
     Only an overlap test misses this, so resolve it here. */
  if ((wantX!==0 || wantY!==0) && !movedX && !movedY) unstick(e, true);

  return [movedX?dx:0, movedY?dy:0];
}

/* ============================================================
   NOISE — the whole stealth layer.

   Power is a LEVEL, not a per-frame increment:
     walk 0.22 -> ~6.6 tiles   sprint 1.0 -> ~16
     bump 0.55 -> ~10.6       exit found 1.3 -> ~20
     door cycling 1.8 -> ~26
   Previously movement passed power*dt*4, which made every frame's contribution
   ~0.06 and therefore made sprinting only marginally louder than walking —
   the entire risk decision was flattened. Walls muffle by 2.6 tiles each. */
const hearRadius = power => 4 + power*12;

function alertAgents(baseR, power, x, y){
  for (const a of G.agents){
    if (a.state==='WALK' && a.born>0) continue;
    const d = Math.hypot(a.x-x, a.y-y);
    if (d > baseR) continue;
    // walls muffle
    let steps = 0, guard=0;
    const sx=Math.floor(a.x), sy=Math.floor(a.y);
    const ex=Math.floor(x), ey=Math.floor(y);
    while (guard++<200){
      const px=sx+Math.sign(ex-sx)*steps, py=sy+Math.sign(ey-sy)*steps;
      if (px===ex&&py===ey) break;
      if (solid(px,py)) steps++;
      if (steps>6) break;
    }
    const eff = baseR - steps*3.0;
    if (d > eff) continue;
    alert(a, x, y, power);
  }
}

/* One-shot noise (revealing an exit, cycling a door, hitting a wall):
   updates the meter, the stats, and alerts. */
function emitNoise(power, x, y){
  G.noise = Math.max(G.noise, power);
  G.noisePeak = Math.max(G.noisePeak, power);
  G.stat.noises++;
  alertAgents(hearRadius(power), power, x, y);
}

/* Continuous noise (footsteps): alerts at full strength every frame, but does
   not inflate the stats or fight the meter decay. */
function sustainedNoise(power, x, y){
  G.noise = Math.max(G.noise, power);
  G.noisePeak = Math.max(G.noisePeak, power);
  alertAgents(hearRadius(power), power, x, y);
}

/* Loud = sprinting, hitting a wall, revealing an exit, cycling a door.
   Quiet = walking.
   Quiet noise only makes it CURIOUS. Only loud noise — or being seen —
   commits it to a full hunt. That is what makes walking survivable and
   sprinting a real decision, and it means you can walk right past a sleeping
   coil pile, while sprinting near one makes it stand up. */
const LOUD = 0.5;

/* Contact. Dying to something you never saw, in a corridor, because it
   happened to be idling there is a gotcha rather than tension. Brushing a
   LOITERING entity does not kill: it startles, commits to a hunt, and makes a
   great deal of noise. You get the chase, not the cheap death. Only contact
   with something already hunting is fatal. */
function brush(a, p){
  if (a.state==='HUNT'){ caught(); return; }
  a.state='HUNT'; a.target={x:p.x, y:p.y}; a.t=0;
  a.rise=Math.max(a.rise, 0.85);
  emitNoise(1.2, p.x, p.y);
  flash('IT TOUCHED YOU');
  Audio_.rattle(1);
}

function alert(a, x, y, power){
  const loud = (power||0) >= LOUD;

  if (a.state==='DORMANT'){
    if (!loud) return;               // walking past a sleeping coil is safe
    a.state='RISING'; a.rise=0; a.target={x,y};
    a.stepT = 0;
    Audio_.rattle(a.born>0 ? 1 : 0.55);
    return;
  }
  if (a.born>0) return;              // the hunter's opening grace period

  if (loud || a.state==='HUNT'){ a.state='HUNT'; a.target={x,y}; a.t=0; }
  else if (a.state==='WALK'){ a.state='SEARCH'; a.t=4.5; a.target={x,y}; }
}

/* ============================================================
   UPDATE
   ============================================================ */
const keys = {};
window.addEventListener('keydown', e=>{
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase()==='f' && G && STATE==='play') G.torch = !G.torch;
  if (e.key==='Escape' && (STATE==='play'||STATE==='pause')) togglePause();
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
});
window.addEventListener('keyup', e=>{ keys[e.key.toLowerCase()] = false; });

function update(dt){
  const p = G.player;
  G.time += dt;
  G.noise = Math.max(0, G.noise - dt*1.55);

  /* --- battery --- */
  if (G.torch){
    G.batt -= BATT_DRAIN*dt;
    if (G.batt<=0){ G.batt=0; G.torch=false; flash('THE TORCH IS DEAD'); }
  }
  for (const b of G.batteries){
    if (b.taken) continue;
    if (Math.hypot(b.x-p.x,b.y-p.y)<0.85){ b.taken=true; G.batt=Math.min(BATT_MAX,G.batt+50); flash('+50 BATTERY'); }
  }

  /* --- movement --- */
  let ix=0, iy=0;
  if (keys['a']||keys['arrowleft'])  ix--;
  if (keys['d']||keys['arrowright']) ix++;
  if (keys['w']||keys['arrowup'])    iy--;
  if (keys['s']||keys['arrowdown'])  iy++;

  const sprinting = (keys['shift']) && (ix||iy);
  const spd = sprinting ? SPRINT : WALK;
  let moving=false, bumped=false;

  unstick(p);

  if (ix||iy){
    const len=Math.hypot(ix,iy); ix/=len; iy/=len;
    const before=[p.x,p.y];
    const [dx,dy]=moveEnt(p, ix*spd*dt, iy*spd*dt, R);
    moving = (dx!==0 || dy!==0);
    p.face = Math.atan2(iy,ix);
    if (!moving && (ix!==0||iy!==0)) bumped=true;   // walked into a partition
  }

  if (moving){
    sustainedNoise(sprinting ? 1.0 : 0.22, p.x, p.y);
    p.stepT -= dt;
    if (p.stepT<=0){
      p.stepT = sprinting ? 0.26 : 0.46;
      Audio_.step(sprinting?1:0.5);
    }
  }
  if (bumped && sprinting) emitNoise(0.55, p.x, p.y);
  else if (bumped) sustainedNoise(0.3, p.x, p.y);

  /* --- torch reveals --- */
  let seenBy = 0, nearest = 99;
  for (const a of G.agents){
    updateAgent(a, dt, p);
    const d = Math.hypot(a.x-p.x, a.y-p.y);
    if (a.state!=='DORMANT' && a.rise>0.5) nearest = Math.min(nearest, d);
    // line of sight check
    if (a.rise>0.5 && d < 8){
      const vx=Math.cos(a.face), vy=Math.sin(a.face);
      const dot = ((p.x-a.x)*vx + (p.y-a.y)*vy) / (d||1);
      if (dot > 0.28 && G.los(a.x,a.y,p.x,p.y)){
        const amb = lightArr[Math.floor(p.y)*MAP_W+Math.floor(p.x)] || 0;
        if (amb > 0.30 || G.torch && d<3.2){
          seenBy = Math.max(seenBy, 1);
          if (a.born<=0){ a.state='HUNT'; a.target={x:p.x,y:p.y}; a.t=0; }
        }
      }
    }
  }
  G.seenBy = Math.max(0, G.seenBy + (seenBy?dt*6:-dt*2.5));
  G.nearest = nearest;

  /* --- torch reveals ---
     The beam is a CONE, matching what is drawn. Revealing in a full 360
     radius let you find exits the light was not even pointing at, which made
     the torch cosmetic. Aim it by facing where you walk. */
  if (G.torch){
    const fx=p.x, fy=p.y;
    const ax=Math.cos(p.face), ay=Math.sin(p.face);
    const inBeam = (tx,ty)=>{
      const d = Math.hypot(tx-fx, ty-fy);
      if (d < 0.001) return true;
      return ((tx-fx)*ax + (ty-fy)*ay)/d > 0.25;   // ~75 degrees
    };
    for (const e of G.exitTiles){
      if (e.found) continue;
      const d=Math.hypot(e.x-fx, e.y-fy);
      if (d < 6.5 && inBeam(e.x+0.5, e.y+0.5) && G.los(fx,fy,e.x+0.5,e.y+0.5)){
        e.found = true;
        G.exitsFound++; G.stat.found++;
        Audio_.rattle(0.7);
        flash('EXIT FOUND \u2014 THAT WAS LOUD');
        emitNoise(1.3, e.x+0.5, e.y+0.5);
      }
    }
    for (const gr of G.graffiti){
      if (gr.seen) continue;
      const d=Math.hypot(gr.x-fx, gr.y-fy);
      if (d<4.2 && inBeam(gr.x+0.5, gr.y+0.5) && G.los(fx,fy,gr.x+0.5,gr.y+0.5)){
        gr.seen=true; flash(gr.text);
      }
    }
  }

  HUD.exitsFound = G.exitsFound;

  /* --- descend ---
     Hold at a found exit for 1.5s and it cycles open. Step away and the
     progress drains fast, so committing to a door is a real decision. */
  const allFound = G.exitsFound >= G.exitTiles.length && G.exitTiles.length>0;
  if (allFound){
    let onExit=false;
    for (const e of G.exitTiles){
      // 1.25 tiles: an exit in a 1-wide alcove is still reachable with the
      // player's 0.33 collision radius, without demanding pixel precision.
      if (Math.hypot(e.x+0.5-p.x, e.y+0.5-p.y) < 1.25){ onExit=true; break; }
    }
    if (onExit){
      if (G.descend===0) Audio_.door();
      G.descend += dt;
      sustainedNoise(1.8, p.x, p.y);
      if (G.descend>=1.5){ nextFloor(); return; }
    } else {
      G.descend = Math.max(0, G.descend - dt*2.5);
    }
  }

  /* --- proximity drone --- */
  const prox = Math.max(0, 1 - G.nearest/13);
  Audio_.drone(prox * (0.35 + G.seenBy*0.65), G.nearest);
}

function updateAgent(a, dt, p){
  a.born = Math.max(0, a.born-dt);
  unstick(a);

  if (a.state==='DORMANT'){ a.rise += (0-a.rise)*Math.min(1,dt*3); return; }

  if (a.state==='RISING'){
    a.rise = Math.min(1, a.rise + dt/1.4);
    a.wakeCd = Math.max(0, a.wakeCd-dt);
    if (a.rise>=1){ a.state='HUNT'; a.t=0; }
    return;
  }

  if (a.state==='WALK'){
    a.rise = Math.min(1, a.rise + dt/1.0);
    if (!a.target || Math.hypot(a.x-a.target.x, a.y-a.target.y)<0.5 || a.t<=0){
      a.target = randomFloorNear(a.x,a.y, 14);
      a.t = 2.6 + Math.random()*3;
    }
    a.t -= dt;
    const spd = 1.5 + G.floor*0.1;
    const ang = Math.atan2(a.target.y-a.y, a.target.x-a.x);
    a.face = ang;
    moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, 0.34);
    return;
  }

  if (a.state==='HUNT'){
    a.rise = Math.min(1, a.rise + dt*2.4);
    a.t -= dt;
    const spd = 3.45 + G.floor*0.34;
    const tgt = a.target || {x:p.x,y:p.y};
    const ang = Math.atan2(tgt.y-a.y, tgt.x-a.x);
    a.face = ang;
    const [dx,dy] = moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, 0.34);
    if (Math.hypot(dx,dy)<0.001){
      // blocked — sidestep along the wall
      moveEnt(a, Math.cos(ang+1.57)*spd*dt, Math.sin(ang+1.57)*spd*dt, 0.34);
    }
    if (Math.hypot(a.x-p.x,a.y-p.y) < 0.52) brush(a, p);
    if (a.t < -8){ a.state='SEARCH'; a.t=6; a.target=randomFloorNear(a.x,a.y,9); }
    return;
  }

  if (a.state==='SEARCH'){
    a.t -= dt;
    if (!a.target || Math.hypot(a.x-a.target.x,a.y-a.target.y)<0.5){
      a.target = randomFloorNear(a.x,a.y,7);
    }
    const ang = Math.atan2(a.target.y-a.y, a.target.x-a.x);
    a.face = ang;
    moveEnt(a, Math.cos(ang)*2.3*dt, Math.sin(ang)*2.3*dt, 0.34);
    if (Math.hypot(a.x-p.x,a.y-p.y) < 0.52) brush(a, p);
    if (a.t<=0){
      a.state = 'DORMANT'; a.rise=0.3; a.target=null;
      if (a.born<=0){ a.state='WALK'; }
    }
  }
}

function randomFloorNear(x,y,rad){
  for (let i=0;i<60;i++){
    const a=Math.random()*6.28, d=Math.random()*rad;
    const nx=x+Math.cos(a)*d, ny=y+Math.sin(a)*d;
    if (!blocked(nx,ny,0.4)) return {x:nx,y:ny};
  }
  return {x,y};
}

/* ============================================================
   FLOW
   ============================================================ */
let STATE='title';       // title | play | pause | dead | win
let RUN_SEED = (Math.random()*1e9)|0;
let lives = 3, floorIdx = 0, runTime = 0;

function nextFloor(){
  floorIdx++;
  if (floorIdx >= FLOORS){ STATE='win'; show('win'); document.getElementById('win-stats').innerHTML =
      `You crossed <b>${FLOORS}</b> floors.<br>Deaths: <b>${G.stat.deaths}</b> &nbsp; Exits found: <b>${G.stat.found}</b><br>Time: <b>${Math.floor(runTime/60)}:${String(Math.floor(runTime%60)).padStart(2,'0')}</b>`;
    document.getElementById('hud').classList.remove('on');
    return;
  }
  buildFloor(floorIdx, RUN_SEED);
}

function caught(){
  if (STATE!=='play') return;
  G.stat.deaths++;
  lives--;
  Audio_.sting(); Audio_.silence();
  STATE='dead';
  document.getElementById('val-lives').innerHTML =
    [0,1,2].map(i=> `<span class="${i<lives?'':'gone'}">&#9679;</span>`).join('');
  document.getElementById('hud').classList.remove('on');
  const sub = document.getElementById('dead-sub');
  if (lives>0) sub.textContent = `${lives} LIVES REMAINING \u2014 TAPE DAMAGED`;
  else sub.textContent = 'SIGNAL LOST';
  show('dead');
}

/* ============================================================
   RENDER
   ============================================================ */
const cam = {x:0,y:0, jx:0, jy:0};

function render(t){
  if (!G) return;
  const p=G.player;

  /* camera follow with a slight lead + breathing */
  cam.x += (p.x - cam.x) * Math.min(1, 0.12);
  cam.y += (p.y - cam.y) * Math.min(1, 0.12);
  const breathe = Math.sin(t*0.0009)*7;
  cam.jx = (Math.random()-0.5)*2.4 + breathe*0.3;
  cam.jy = (Math.random()-0.5)*2.4;

  const px = cvs.width/(2*TILE*SCALE) ;
  const ox = (cam.x - px)*TILE*SCALE + cam.jx;
  const oy = (cam.y - cvs.height/(2*TILE*SCALE))*TILE*SCALE + cam.jy;

  ctx.setTransform(SCALE,0,0,SCALE,0,0);
  ctx.save();
  ctx.translate(ox, oy);

  const tlx = Math.floor((-ox)/TILE)-1, tly = Math.floor((-oy)/TILE)-1;
  const tw  = Math.ceil(cvs.width/(TILE*SCALE))+3;
  const th  = Math.ceil(cvs.height/(TILE*SCALE))+3;

  const x0=Math.max(0,tlx), y0=Math.max(0,tly);
  const x1=Math.min(MAP_W-1,tlx+tw), y1=Math.min(MAP_H-1,tly+th);

  /* ---------- 1. carpet ---------- */
  ctx.fillStyle = carpetPat;
  ctx.fillRect(x0*TILE, y0*TILE, (x1-x0+1)*TILE, (y1-y0+1)*TILE);
  // per-tile tonal variation
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
    const h=hash2(x,y);
    if (h<0.14){
      ctx.fillStyle = h<0.05 ? 'rgba(52,47,22,0.16)' : 'rgba(238,228,168,0.10)';
      ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
    }
  }

  /* ---------- 2. wall faces (south-facing) ---------- */
  const FACE = TILE*0.46;
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
    if (G.grid[y*MAP_W+x]!==WALL) continue;
    if (y+1<MAP_H && G.grid[(y+1)*MAP_W+x]===FLOOR){
      ctx.fillStyle = wallPat;
      ctx.fillRect(x*TILE, (y+1)*TILE, TILE, FACE);
      ctx.fillStyle = 'rgba(30,26,12,0.34)';
      ctx.fillRect(x*TILE, (y+1)*TILE+FACE-2, TILE, 2);
    }
  }

  /* ---------- 3. wall tops ---------- */
  ctx.fillStyle = ceilPat;
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
    if (G.grid[y*MAP_W+x]!==WALL) continue;
    ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
    ctx.fillStyle='rgba(20,17,8,0.20)';
    ctx.fillRect(x*TILE, y*TILE, TILE, 3);
  }

  /* ---------- 4. world markers ---------- */
  for (const b of G.batteries){
    if (b.taken) continue;
    const bx=(b.x+0.5)*TILE, by=(b.y+0.5)*TILE;
    const pu = 1 + Math.sin(t*0.004)*0.12;
    ctx.fillStyle='rgba(20,17,8,0.45)'; ctx.fillRect(bx-9, by-11, 18, 22);
    ctx.fillStyle='#c8d97a'; ctx.fillRect(bx-7, by-9, 14, 18);
    ctx.fillStyle='#2c2a12'; ctx.fillRect(bx-5, by-7, 10, 5*pu+3);
    ctx.strokeStyle='rgba(232,217,138,0.5)'; ctx.lineWidth=1;
    ctx.strokeRect(bx-7.5, by-9.5, 15, 19);
  }

  for (const e of G.exitTiles){
    const ex=(e.x+0.5)*TILE, ey=(e.y+0.5)*TILE;
    if (!e.found){
      // nothing but the partition. exactly as it should be.
      continue;
    }
    const open = e.open>0 ? 1 : 0;
    ctx.fillStyle = open ? 'rgba(30,44,26,0.92)' : 'rgba(16,26,16,0.86)';
    ctx.fillRect(e.x*TILE+3, e.y*TILE+2, TILE-6, TILE-3);
    ctx.strokeStyle = open ? '#8fd07a' : 'rgba(143,208,122,0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(e.x*TILE+4, e.y*TILE+3, TILE-8, TILE-6);
    // glow
    const gr=ctx.createRadialGradient(ex,ey,2,ex,ey,TILE*2.4);
    gr.addColorStop(0, open?'rgba(143,208,122,0.34)':'rgba(143,208,122,0.15)');
    gr.addColorStop(1,'rgba(143,208,122,0)');
    ctx.fillStyle=gr;
    ctx.fillRect(ex-TILE*2.4, ey-TILE*2.4, TILE*4.8, TILE*4.8);
    ctx.fillStyle='#cdf3bd';
    ctx.font='9px "Courier New",monospace';
    ctx.textAlign='center';
    ctx.fillText('EXIT', ex, ey+TILE+16);
  }

  /* ---------- 5. entities + player, y-sorted ---------- */
  const draws = [];
  for (const a of G.agents) draws.push({y:a.y, kind:'a', o:a});
  draws.push({y:p.y, kind:'p', o:p});
  draws.sort((m,n)=> m.y-n.y);
  for (const d of draws) d.kind==='a' ? drawAgent(d.o,t) : drawPlayer(p,t);

  ctx.restore();

  /* ---------- 6. lighting ---------- */
  ctx.setTransform(1,0,0,1,0,0);

  // ambient bake (multiply) — never pitch black, always mono-yellow
  ctx.globalCompositeOperation='multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lightCv, ox, oy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);

  // flickering fluorescents (additive, above the bake)
  ctx.globalCompositeOperation='lighter';
  for (const f of G.fixtures){
    let a = 0.16;
    if (f.flicker){
      a *= (0.35 + 0.65*Math.max(0, Math.sin(t*0.001*f.flicker + f.phase)));
      if (Math.random()<0.02) a*=0.15;
    }
    const fx=(f.x*TILE)*SCALE+ox, fy=(f.y*TILE)*SCALE+oy;
    const rr=f.r*TILE*SCALE;
    if (fx<-rr||fy<-rr||fx>cvs.width+rr||fy>cvs.height+rr) continue;
    const gr=ctx.createRadialGradient(fx,fy,0,fx,fy,rr);
    gr.addColorStop(0,`rgba(255,248,196,${a})`);
    gr.addColorStop(0.5,`rgba(226,214,150,${a*0.4})`);
    gr.addColorStop(1,'rgba(180,170,110,0)');
    ctx.fillStyle=gr;
    ctx.fillRect(fx-rr,fy-rr,rr*2,rr*2);
    // the tube itself
    ctx.fillStyle=`rgba(255,252,220,${0.32+a})`;
    ctx.fillRect(fx-rr*0.13, fy-rr*0.05, rr*0.26, rr*0.1);
  }

  // torch — INFORMATION ONLY. it does not repel anything.
  if (G.torch){
    const px2=p.x*TILE*SCALE+ox, py2=p.y*TILE*SCALE+oy;
    const rad=7.6*TILE*SCALE;
    ctx.save();
    ctx.translate(px2,py2);
    ctx.rotate(p.face);
    const cone = ctx.createRadialGradient(0,0,6,0,0,rad);
    cone.addColorStop(0,'rgba(255,250,214,0.42)');
    cone.addColorStop(0.42,'rgba(238,230,180,0.17)');
    cone.addColorStop(1,'rgba(210,200,150,0)');
    ctx.fillStyle=cone;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,rad,-1.05,1.05);
    ctx.closePath();
    ctx.fill();
    // faint peripheral spill so the beam has a soft edge
    ctx.strokeStyle='rgba(232,224,176,0.10)';
    ctx.lineWidth=rad*0.34;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,rad*0.80,-1.25,1.25);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // close spill so you never stand in pitch dark
    const sp=ctx.createRadialGradient(px2,py2,0,px2,py2,rad*0.3);
    sp.addColorStop(0,'rgba(232,224,176,0.16)');
    sp.addColorStop(1,'rgba(232,224,176,0)');
    ctx.fillStyle=sp;
    ctx.fillRect(px2-rad*0.3,py2-rad*0.3,rad*0.6,rad*0.6);
  }
  ctx.globalCompositeOperation='source-over';

  /* ---------- 7. danger / awareness ---------- */
  const seen = Math.min(1,G.seenBy);
  if (seen>0.01){
    const vg=ctx.createRadialGradient(cvs.width/2,cvs.height/2,cvs.height*0.18,
                                      cvs.width/2,cvs.height/2,cvs.height*0.78);
    vg.addColorStop(0,'rgba(216,80,60,0)');
    vg.addColorStop(1,`rgba(150,26,16,${0.62*seen})`);
    ctx.fillStyle=vg; ctx.fillRect(0,0,cvs.width,cvs.height);
  }
  // vignette
  const vg2=ctx.createRadialGradient(cvs.width/2,cvs.height/2,cvs.height*0.30,
                                     cvs.width/2,cvs.height/2,cvs.height*0.95);
  vg2.addColorStop(0,'rgba(0,0,0,0)');
  vg2.addColorStop(1,'rgba(0,0,0,0.82)');
  ctx.fillStyle=vg2; ctx.fillRect(0,0,cvs.width,cvs.height);

  /* ---------- 8. VHS composite ---------- */
  // tracking band
  const bandY = ((t*0.055) % (cvs.height+220)) - 110;
  const tg=ctx.createLinearGradient(0,bandY,0,bandY+110);
  tg.addColorStop(0,'rgba(255,255,255,0)');
  tg.addColorStop(0.5,'rgba(255,248,220,0.055)');
  tg.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=tg; ctx.fillRect(0,bandY,cvs.width,110);

  // scanlines
  ctx.globalCompositeOperation='multiply';
  ctx.fillStyle=scanPat;
  ctx.fillRect(0,0,cvs.width,cvs.height);
  ctx.globalCompositeOperation='source-over';

  // grain
  ctx.globalCompositeOperation='overlay';
  ctx.globalAlpha=0.055;
  const gx=-(Math.random()*160)|0, gy=-(Math.random()*160)|0;
  for(let y=gy;y<cvs.height;y+=160) for(let x=gx;x<cvs.width;x+=160) ctx.drawImage(grainCv,x,y);
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';

  // chromatic ghost
  ctx.globalCompositeOperation='lighter';
  ctx.globalAlpha=0.055;
  const ca = 1 + Math.round(Math.random()*2);
  ctx.drawImage(cvs, -ca, 0);
  ctx.drawImage(cvs, ca*1.6, 0);
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';

  // dropouts
  if (Math.random()<0.02){
    const y=(Math.random()*cvs.height)|0;
    ctx.fillStyle='rgba(210,206,190,0.16)';
    ctx.fillRect(0,y,cvs.width,1+Math.random()*2|0);
  }
}

function drawPlayer(p, t){
  const x=(p.x+0.5)*TILE, y=(p.y+0.5)*TILE;
  ctx.fillStyle='rgba(10,8,4,0.42)';
  ctx.beginPath(); ctx.ellipse(x, y+7, TILE*0.34, TILE*0.17, 0,0,6.283); ctx.fill();
  // body
  ctx.fillStyle='#22201a';
  ctx.beginPath(); ctx.ellipse(x, y+2, TILE*0.28, TILE*0.31, 0,0,6.283); ctx.fill();
  // head, offset "up" so it reads as a figure seen from behind/above
  ctx.fillStyle='#8d8262';
  ctx.beginPath(); ctx.arc(x, y-3, TILE*0.155, 0, 6.283); ctx.fill();
  ctx.fillStyle='rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(x, y-1.5, TILE*0.155, 0.2, 2.94); ctx.fill();
}

function drawAgent(a, t){
  const x=(a.x+0.5)*TILE, y=(a.y+0.5)*TILE;
  const h = a.rise;
  const wob = Math.sin(t*0.004 + a.x)*0.06;

  // shadow
  ctx.fillStyle='rgba(6,5,3,0.5)';
  ctx.beginPath();
  ctx.ellipse(x, y+4, TILE*(0.36+0.16*h), TILE*(0.14+0.05*h), 0,0,6.283);
  ctx.fill();

  if (h < 0.02){
    /* DORMANT — a large pile of wire on the carpet */
    const loops = 7;
    for (let i=loops;i>0;i--){
      const rr = TILE*(0.10 + i*0.048);
      ctx.strokeStyle = i%2 ? '#0d0c0a' : '#161412';
      ctx.lineWidth = Math.max(2.4, TILE*0.075 - i*0.6);
      ctx.beginPath();
      ctx.ellipse(x + Math.sin(t*0.0015+i)*2.2*wob*8, y + Math.cos(t*0.0013+i*0.8)*1.8*wob*8,
                  rr*1.25, rr*0.82, 0.3+i*0.16, 0, 6.283);
      ctx.stroke();
      // faint specular on the top-left of each coil
      ctx.strokeStyle='rgba(120,112,96,0.30)';
      ctx.lineWidth=1.2;
      ctx.beginPath();
      ctx.ellipse(x + Math.sin(t*0.0015+i)*2.2*wob*8, y + Math.cos(t*0.0013+i*0.8)*1.8*wob*8,
                  rr*1.25, rr*0.82, 0.3+i*0.16, 3.4, 4.5);
      ctx.stroke();
    }
    return;
  }

  /* RISING / HUNTING — it stands up, tall, made of stacked coils */
  const N = 9;
  const HGT = TILE*2.55*h;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-a.face + Math.PI/2 + Math.sin(t*0.0018)*0.05);

  // faint aura
  const ag=ctx.createRadialGradient(0,0,0,0,0,HGT*0.9);
  ag.addColorStop(0,'rgba(0,0,0,0.34)');
  ag.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=ag;
  ctx.beginPath(); ctx.ellipse(0,0,TILE*0.5, HGT*0.62, 0,0,6.283); ctx.fill();

  for (let i=0;i<=N;i++){
    const k = i/N;
    const yy = -k*HGT;
    const rx = TILE*(0.34*(1-k*0.72) + 0.05) * (1 + Math.sin(k*7+t*0.002)*0.08);
    const ry = rx*0.40;
    ctx.strokeStyle = (i%2) ? '#080706' : '#131110';
    ctx.lineWidth = Math.max(2, TILE*0.088*(1-k*0.35));
    ctx.beginPath();
    ctx.ellipse(Math.sin(k*9+t*0.003)*TILE*0.05*k, yy, rx, ry, 0, 0, 6.283);
    ctx.stroke();
    ctx.strokeStyle='rgba(126,118,102,0.26)';
    ctx.lineWidth=1.1;
    ctx.beginPath();
    ctx.ellipse(Math.sin(k*9+t*0.003)*TILE*0.05*k, yy, rx, ry, 0, 3.5, 4.7);
    ctx.stroke();
  }

  // strands flaring loose near the top
  for (let i=0;i<4;i++){
    const k=0.55+i*0.12;
    const yy=-k*HGT;
    const sway=Math.sin(t*0.0035+i*1.7)*TILE*0.14;
    ctx.strokeStyle='#0a0908'; ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(0,yy);
    ctx.quadraticCurveTo(sway, yy-TILE*0.34, sway*1.5, yy-TILE*0.62);
    ctx.stroke();
  }

  ctx.restore();

  // when it has you, a thin red rim
  if (G.seenBy>0.35){
    ctx.strokeStyle=`rgba(216,80,60,${0.30*G.seenBy})`;
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(x,y,TILE*0.44,TILE*0.44,0,0,6.283); ctx.stroke();
  }
}

/* ============================================================
   HUD + SCREENS
   ============================================================ */
const HUD = {
  batt: document.getElementById('bar-batt'),
  noise: document.getElementById('bar-noise'),
  noiseWrap: document.querySelector('.bar.noise'),
  vBatt: document.getElementById('val-batt'),
  vNoise: document.getElementById('val-noise'),
  vExits: document.getElementById('val-exits'),
  vDepth: document.getElementById('val-depth'),
  vLives: document.getElementById('val-lives'),
  hud: document.getElementById('hud'),
  exitsFound: 0
};

let flashT = 0;
function flash(text){
  const el=document.getElementById('flashnote');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(flashT);
  flashT = setTimeout(()=>el.classList.remove('on'), 3400);
}

function show(which){
  for (const s of ['title','pause','dead','win'])
    document.getElementById('screen-'+s).classList.toggle('hidden', s!==which);
}
function hideAll(){ for (const s of ['title','pause','dead','win'])
    document.getElementById('screen-'+s).classList.add('hidden'); }

function togglePause(){
  if (STATE==='play'){ STATE='pause'; show('pause'); }
  else if (STATE==='pause'){ STATE='play'; hideAll(); }
}

function updateHUD(){
  if (!G) return;
  HUD.batt.style.width = (G.batt/BATT_MAX*100)+'%';
  HUD.vBatt.textContent = Math.ceil(G.batt);
  const np = Math.min(1, G.noisePeak);
  HUD.noise.style.width = (G.noise/BATT_MAX*100)+'%';
  HUD.vNoise.textContent = String(Math.round(G.noise/BATT_MAX*100)).padStart(2,'0');
  HUD.noiseWrap.classList.toggle('hot', G.noise>0.45);
  G.noisePeak = Math.max(G.noise, G.noisePeak - 0.004);
  HUD.vExits.textContent = `${G.exitsFound} / ${G.exitTiles.length}`;
  HUD.vDepth.textContent = `${G.floor+1} / ${FLOORS}`;
  HUD.vLives.innerHTML = [0,1,2].map(i=>`<span class="${i<lives?'':'gone'}">&#9679;</span>`).join('');
}

function setPrompt(){
  const el=document.getElementById('prompt');
  if (!G){ el.classList.remove('on'); return; }
  const all = G.exitsFound>=G.exitTiles.length && G.exitTiles.length>0;
  if (G.descend>0.02) el.textContent = 'cycling door \u2014 do not stop';
  else if (all) el.textContent = 'an exit is open \u2014 get to one';
  else if (G.torch) el.textContent = 'find all ' + G.exitTiles.length + ' exits';
  else el.textContent = 'torch off';
  el.classList.add('on');
}

/* ---------- buttons ---------- */
document.getElementById('btn-start').onclick = ()=>{
  Audio_.init();
  if (Audio_.ctx && Audio_.ctx.state==='suspended') Audio_.ctx.resume();
  RUN_SEED = (Math.random()*1e9)|0;
  lives=3; floorIdx=0; runTime=0;
  document.getElementById('val-lives').innerHTML='&#9679;&#9679;&#9679;';
  buildFloor(0, RUN_SEED);
  hideAll();
  STATE='play';
  document.getElementById('hud').classList.add('on');
};
document.getElementById('btn-resume').onclick = togglePause;
document.getElementById('btn-retry').onclick = ()=>{
  if (lives<=0){
    document.getElementById('btn-start').click(); return;
  }
  buildFloor(floorIdx, RUN_SEED);
  G.batt = Math.max(G.batt, 55);
  for (const a of G.agents){ a.born=3.0; }
  hideAll(); STATE='play';
  document.getElementById('hud').classList.add('on');
};
document.getElementById('btn-again').onclick = ()=>{
  document.getElementById('btn-start').click();
};

/* ============================================================
   LOOP
   ============================================================ */
let last = performance.now();
function frame(now){
  let dt = (now-last)/1000;
  last = now;
  dt = Math.min(dt, 0.05);

  if (STATE==='play'){ runTime+=dt; update(dt); updateHUD(); setPrompt(); }
  if (G) render(now);

  requestAnimationFrame(frame);
}

resize();
buildPatterns();
buildFloor(0, 12345);
requestAnimationFrame(frame);