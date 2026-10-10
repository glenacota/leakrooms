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
const RA     = 0.34;              // Lifeform collision radius (bulkier)
const TORCH_OFF = 0.135;           // how far in front the torch is held, in tiles

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

  // --- wall top (seen from directly above) ---
  c = document.createElement('canvas'); c.width=c.height=24;
  g = c.getContext('2d');
  g.fillStyle='#7d7442'; g.fillRect(0,0,24,24);
  for(let i=0;i<520;i++){
    g.fillStyle = Math.random()<0.5?'rgba(34,30,14,0.30)':'rgba(150,140,86,0.16)';
    g.fillRect(Math.random()*24, Math.random()*24, 2,2);
  }
  ceilPat = ctx.createPattern(c,'repeat');

  // --- VHS scanlines ---
  c = document.createElement('canvas'); c.width=1; c.height=4;
  g = c.getContext('2d');
  g.fillStyle='rgba(0,0,0,0)'; g.fillRect(0,0,1,4);
  g.fillStyle='rgba(0,0,0,0.28)'; g.fillRect(0,3,1,1);
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
  /* Subdivision is driven by SIZE, not by a depth counter. A fixed depth ran
     out of budget while cells were still ~18 tiles across, so every floor
     kept at least one room big enough to read as an empty field.
     MAXROOM is a real ceiling: the cut is clamped so a child is never wider
     than its parent, and splitting is refused only once the cell is too
     narrow to divide without producing a closet. Always cut the longer axis
     so children converge on the ceiling instead of drifting past it. */
  const MAXROOM = 12, MINCUT = 6;
  (function split(x,y,w,h,depth){
    const tooNarrow = (w < MINCUT*2 && h < MINCUT*2);
    if (depth <= 0 || tooNarrow){
      leaves.push({x,y,w,h,id:leaves.length});
      return;
    }
    if (w >= h){
      if (w < MINCUT*2){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      if (w <= MAXROOM && h <= MAXROOM){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      let cut = Math.round(w*(0.75 + rng()*0.5)/2);
      cut = Math.max(MINCUT, Math.min(w-MINCUT, cut));
      split(x,      y, cut, h, depth-1);
      split(x+cut, y, w-cut, h, depth-1);
      // vertical partition at column x+cut: a gate straddles COLUMNS at a row
      const gateRow = () => y + 1 + Math.floor(rng()*Math.max(1,h-2));
      doors.push({axis:'x', cut:x+cut, along:gateRow(), width:2});
      if (rng() < 0.45) doors.push({axis:'x', cut:x+cut, along:gateRow(), width:2});
    } else {
      if (h < MINCUT*2){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      if (w <= MAXROOM && h <= MAXROOM){ leaves.push({x,y,w,h,id:leaves.length}); return; }
      let cut = Math.round(h*(0.75 + rng()*0.5)/2);
      cut = Math.max(MINCUT, Math.min(h-MINCUT, cut));
      split(x, y,      w, cut, depth-1);
      split(x, y+cut, w, h-cut, depth-1);
      // horizontal partition at row y+cut: a gate straddles ROWS at a column
      const gateCol = () => x + 1 + Math.floor(rng()*Math.max(1,w-2));
      doors.push({axis:'y', cut:y+cut, along:gateCol(), width:2});
      if (rng() < 0.45) doors.push({axis:'y', cut:y+cut, along:gateCol(), width:2});
    }
  })(1,1,MAP_W-2,MAP_H-2,12);

  /* Carve each leaf as a room, inset unevenly so the partitions read as
     temporary site walls rather than a regular grid. Insets are capped: with
     smaller cells an uncapped inset of 3+3 could produce a room wider than
     its cell, which spilled into the partition band and welded two
     neighbouring rooms into one big open space. */
  const MINROOM = 6;
  const inset = span => 1 + Math.floor(rng()*Math.min(2, Math.max(1, Math.floor((span-MINROOM)/2))));
  for (const L of leaves){
    const ix1 = inset(L.w), ix2 = inset(L.w);
    const iy1 = inset(L.h), iy2 = inset(L.h);
    const rx = L.x+ix1, ry = L.y+iy1;
    const rw = Math.max(MINROOM, L.w-ix1-ix2);
    const rh = Math.max(MINROOM, L.h-iy1-iy2);
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
  for (const d of doors){
    for (let k=0; k<d.width; k++){
      const a = d.along + k;
      if (d.axis === 'x'){
        // vertical partition: tunnel sideways through it, gate spans 2 rows
        for (let x=d.cut-1, g=0; g<14; x--, g++){
          if (x<1) break;
          grid[idx(x,a)] = FLOOR;
          if (grid[idx(x-1,a)]===FLOOR) break;
        }
        for (let x=d.cut, g=0; g<14; x++, g++){
          if (x>=MAP_W-2) break;
          grid[idx(x,a)] = FLOOR;
          if (grid[idx(x+1,a)]===FLOOR) break;
        }
      } else {
        // horizontal partition: tunnel vertically, gate spans 2 columns
        for (let y=d.cut-1, g=0; g<14; y--, g++){
          if (y<1) break;
          grid[idx(a,y)] = FLOOR;
          if (grid[idx(a,y-1)]===FLOOR) break;
        }
        for (let y=d.cut, g=0; g<14; y++, g++){
          if (y>=MAP_H-2) break;
          grid[idx(a,y)] = FLOOR;
          if (grid[idx(a,y+1)]===FLOOR) break;
        }
      }
    }
  }

  /* Extra partitions inside the larger rooms. The BSP alone still leaves
     some cells big enough to read as an empty field. These stubs add wall
     area and create alcoves WITHOUT dividing a room in two — a full split
     can strand one half, which the connectivity repair would then tunnel
     back through a visible hole in the partition. */
  for (const L of rooms){
    if (L.rw < 6 && L.rh < 6) continue;
    const cym = L.ry + L.rh/2;
    const cxm = L.rx + L.rw/2;
    const stubs = 1 + (rng() < 0.65 ? 1 : 0) + (rng() < 0.3 ? 1 : 0);
    for (let n=0; n<stubs; n++){
      if (L.rw >= L.rh){
        const sx = L.rx + 1 + Math.floor(rng()*Math.max(1, L.rw-2));
        const len = 2 + Math.floor(rng()*Math.max(1, L.rh-3));
        const y0 = rng() < 0.5 ? L.ry : L.ry + L.rh - len;
        const th2 = 1 + (rng() < 0.45 ? 1 : 0);
        for (let y=y0; y<y0+len; y++){
          if (y<L.ry || y>=L.ry+L.rh) continue;
          if (Math.abs((y+0.5)-cym) < 1.6) continue;   // leave the spawn clear
          for (let k=0;k<th2;k++){
            if (sx+k < L.rx+L.rw) grid[idx(sx+k,y)] = WALL;
          }
        }
      } else {
        const sy = L.ry + 1 + Math.floor(rng()*Math.max(1, L.rh-2));
        const len = 2 + Math.floor(rng()*Math.max(1, L.rw-3));
        const x0 = rng() < 0.5 ? L.rx : L.rx + L.rw - len;
        const th3 = 1 + (rng() < 0.45 ? 1 : 0);
        for (let x=x0; x<x0+len; x++){
          if (x<L.rx || x>=L.rx+L.rw) continue;
          if (Math.abs((x+0.5)-cxm) < 1.6) continue;
          for (let k=0;k<th3;k++){
            if (sy+k < L.ry+L.rh) grid[idx(x,sy+k)] = WALL;
          }
        }
      }
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
let lightArr, lightCv, postCv;  // postCv = VHS composite scratch

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
  const candidates = maze.rooms.filter(r=>r.rw>=6 && r.rh>=6);
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

  /* --- each exit = an INTERIOR wall tile that touches open floor.
         Must not land on the outer border: there the player's body can
         never get within the descend radius, which would make the floor
         unwinnable.
         With a dense BSP the ring just outside a room is often another
         room's floor rather than wall, so the ring alone is not enough —
         hence three escalating fallbacks before we give up on a slot. --- */
  const exitTiles = [];
  const INTERIOR = (x,y)=> x>0 && y>0 && x<MAP_W-1 && y<MAP_H-1;
  const touchesFloor = (tx,ty)=>
    (inB(tx+1,ty)&&at(tx+1,ty)===FLOOR)||(inB(tx-1,ty)&&at(tx-1,ty)===FLOOR)||
    (inB(tx,ty+1)&&at(tx,ty+1)===FLOOR)||(inB(tx,ty-1)&&at(tx,ty-1)===FLOOR);

  for (const r of exits){
    // 1. the ring immediately around the room
    const ring = [];
    for (let x=r.rx; x<r.rx+r.rw; x++){ ring.push([x,r.ry-1]); ring.push([x,r.ry+r.rh]); }
    for (let y=r.ry; y<r.ry+r.rh; y++){ ring.push([r.rx-1,y]); ring.push([r.rx+r.rw,y]); }
    let pool2 = ring.filter(([tx,ty]) => INTERIOR(tx,ty) && at(tx,ty)===WALL && touchesFloor(tx,ty));

    // 2. any interior wall tile touching THIS room's floor
    if (!pool2.length){
      const near = [];
      for (let y=r.ry; y<r.ry+r.rh; y++) for (let x=r.rx; x<r.rx+r.rw; x++){
        for (const [tx,ty] of [[x,y-1],[x,y+1],[x-1,y],[x+1,y]])
          if (INTERIOR(tx,ty) && at(tx,ty)===WALL && touchesFloor(tx,ty)) near.push([tx,ty]);
      }
      pool2 = near;
    }
    // 3. any interior wall tile touching floor anywhere — keeps the floor
    //    winnable even if a room is fully walled in by other rooms
    if (!pool2.length){
      const any = [];
      for (let y=1;y<MAP_H-1 && any.length<4000;y++) for (let x=1;x<MAP_W-1;x++){
        if (at(x,y)===WALL && touchesFloor(x,y)) any.push([x,y]);
      }
      // prefer one reasonably near the room it belongs to
      const cx=r.rx+r.rw/2, cy=r.ry+r.rh/2;
      any.sort((a,b)=>Math.hypot(a[0]-cx,a[1]-cy)-Math.hypot(b[0]-cx,b[1]-cy));
      pool2 = any.slice(0,60);
    }
    if (!pool2.length) continue;
    const [bx,by] = pool2[(rng()*pool2.length)|0];
    if (exitTiles.some(e=>e.x===bx && e.y===by)) continue;
    exitTiles.push({x:bx, y:by, found:false, open:0, room:r});
  }

  /* Pick a floor tile inside a room. Rooms now contain partition stubs, so a
     plain random pick can land inside a wall. */
  const floorTileIn = (r, pad=1) => {
    const w = r.rw-2*pad, h = r.rh-2*pad;
    if (w > 0 && h > 0){
      for (let i=0;i<16;i++){
        const tx = r.rx+pad + Math.floor(rng()*w);
        const ty = r.ry+pad + Math.floor(rng()*h);
        if (maze.grid[ty*MAP_W+tx]===FLOOR) return {x:tx, y:ty};
      }
    }
    return { x: r.rx + (r.rw>>1), y: r.ry + (r.rh>>1) };
  };

  /* --- fixtures: ~18% of rooms unlit, some with two panels --- */
  const fixtures = [];
  for (const r of maze.rooms){
    if (r.rw<4 || r.rh<4) continue;
    if (rng() < 0.18) continue;
    const n = (r.rw*r.rh > 260 && rng()<0.4) ? 2 : 1;
    for (let i=0;i<n;i++){
      // radius follows the room, so no room ends up a black hole
      const rad = Math.max(9, Math.min(19, Math.hypot(r.rw, r.rh)*0.62));
      const sp = floorTileIn(r);
      fixtures.push({
        x: sp.x + 0.5,
        y: sp.y + 0.5,
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
    const sp = floorTileIn(r);
    batteries.push({ x: sp.x+0.5, y: sp.y+0.5, taken:false });
  }
  for (let i=0;i<6+floorNum*2;i++){
    const src = (rng()<0.6 && litRooms.length) ? litRooms : maze.rooms;
    const r = src[(rng()*src.length)|0];
    if (!r || r.rw<4||r.rh<4) continue;
    const sp = floorTileIn(r);
    batteries.push({ x: sp.x+0.5, y: sp.y+0.5, taken:false });
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
    const sp = floorTileIn(r);
    graffiti.push({ x: sp.x+0.5, y: sp.y+0.5,
                    text:NOTES[(rng()*NOTES.length)|0], seen:false });
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
      const v = Math.min(1, f.i * fall * fall * 1.95);
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
    if (at(x,y)===FLOOR && lightArr[i] < 0.42) lightArr[i] = 0.42;
  }
  // walls catch light from adjacent floor (their face is visible).
  // This MUST read the post-blur, post-floor values. It used to read `tmp`
  // (pre-blur and pre-ambient-floor), so a wall beside unlit floor got ~0
  // light, multiplied to near-black, and every partition read as a hole in
  // the ground rather than a wall.
  const wallSrc = new Float32Array(lightArr);
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const i=y*MAP_W+x;
    if (at(x,y)!==WALL) continue;
    let m=0;
    if (inB(x+1,y)&&at(x+1,y)===FLOOR) m=Math.max(m,wallSrc[i+1]);
    if (inB(x-1,y)&&at(x-1,y)===FLOOR) m=Math.max(m,wallSrc[i-1]);
    if (inB(x,y+1)&&at(x,y+1)===FLOOR) m=Math.max(m,wallSrc[i+MAP_W]);
    if (inB(x,y-1)&&at(x,y-1)===FLOOR) m=Math.max(m,wallSrc[i-MAP_W]);
    // a wall deep inside a block still catches some bounce from its room
    lightArr[i] = Math.max(m*0.95, 0.34);
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
function unstick(e, r){
  // Test with the entity's OWN radius. A hardcoded 0.34 here made a player
  // resting flush against a wall (gap 0.335, comfortably clear at R=0.33)
  // read as overlapping, so every wall contact nudged it ~0.08 tiles sideways.
  if (!blocked(e.x, e.y, r)) return false;
  let bx=null, by=null, bd=Infinity;
  for (let a=0; a<24; a++){
    const ang = a/24*Math.PI*2;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d=0.08; d<=0.9; d+=0.08){
      const nx = e.x+cx*d, ny = e.y+cy*d;
      if (!blocked(nx, ny, r)){ if (d<bd){ bd=d; bx=nx; by=ny; } break; }
    }
  }
  if (bx!==null){ e.x=bx; e.y=by; return true; }
  return false;
}

/* Escape a genuine pocket: both requested axes are blocked, so the entity is
   legal but immobile. Walks a short ring biased toward the direction actually
   being asked for, and never moves more than 0.45 tiles — this is a nudge out
   of a wedge, not a teleport. */
function depenetrate(e, r, dx, dy){
  const want = Math.atan2(dy, dx);
  let bx=null, by=null, bd=Infinity;
  for (let a=-3; a<=3; a++){
    const ang = want + a*(Math.PI/12);          // try straight on first, then fan out
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d=0.08; d<=0.45; d+=0.08){
      const nx = e.x+cx*d, ny = e.y+cy*d;
      if (!blocked(nx, ny, r)){ if (d<bd){ bd=d; bx=nx; by=ny; } break; }
    }
  }
  if (bx!==null){ e.x=bx; e.y=by; return true; }
  return false;
}

/* Move: try the full step, then slide on each axis, then depenetrate.
   No perpendicular "corner assist". That used to nudge sideways whenever an
   axis was blocked, and it tried the perpendicular in a FIXED order (+1 before
   -1) — so holding up against a wall always picked +x and walked you right
   until you left the screen. If your circle overlaps a wall corner then
   stopping is the correct answer; you round the corner by also pressing the
   other direction, which the axis-only fallback already handles. */
function moveEnt(e, dx, dy, r){
  if (dx===0 && dy===0) return [0,0];

  // full step (diagonal input moves on both axes)
  if (!blocked(e.x+dx, e.y+dy, r)){ e.x+=dx; e.y+=dy; return [dx,dy]; }
  // slide along the wall
  if (dx!==0 && !blocked(e.x+dx, e.y, r)){ e.x+=dx; return [dx,0]; }
  if (dy!==0 && !blocked(e.x, e.y+dy, r)){ e.y+=dy; return [0,dy]; }
  /* Only a DIAGONAL press into a concave corner counts as wedged. Being
     unable to move while pressing straight into a wall is the normal resting
     state, not a trap — depenetrating there just nudged the avatar sideways
     every frame, which read as drift. */
  if (dx!==0 && dy!==0) depenetrate(e, r, dx, dy);
  return [0,0];
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

/* ENTER is the confirm key for whichever modal is up: start, resume, rewind,
   run again. It also fires when a button already has focus, so guard against
   the click landing twice. */
const MODAL_ACTION = {
  title:  ()=>document.getElementById('btn-start').click(),
  pause:  ()=>document.getElementById('btn-resume').click(),
  dead:   ()=>document.getElementById('btn-retry').click(),
  win:    ()=>document.getElementById('btn-again').click(),
};

window.addEventListener('keydown', e=>{
  const k = e.key.toLowerCase();
  keys[k] = true;

  if (k==='enter'){
    const act = STATE==='title' ? MODAL_ACTION.title
              : STATE==='pause' ? MODAL_ACTION.pause
              : STATE==='dead'  ? MODAL_ACTION.dead
              : STATE==='win'   ? MODAL_ACTION.win
              : null;
    if (act){
      const focused = document.activeElement;
      const onButton = focused && focused.tagName === 'BUTTON';
      act();                                  // close the modal
      if (onButton) focused.blur();           // no second activation via Enter
    }
    e.preventDefault();
    return;
  }

  if (k==='f' && G && STATE==='play') G.torch = !G.torch;
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

  unstick(p, R);

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
    const fx=p.x + Math.cos(p.face)*TORCH_OFF;
    const fy=p.y + Math.sin(p.face)*TORCH_OFF;
    const ax=Math.cos(p.face), ay=Math.sin(p.face);
    const inBeam = (tx,ty)=>{
      const d = Math.hypot(tx-fx, ty-fy);
      if (d < 0.001) return true;
      return ((tx-fx)*ax + (ty-fy)*ay)/d > 0.25;   // ~75 degrees
    };
    for (const e of G.exitTiles){
      if (e.found) continue;
      const d=Math.hypot(e.x+0.5-fx, e.y+0.5-fy);
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
      const d=Math.hypot(gr.x+0.5-fx, gr.y+0.5-fy);
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
  unstick(a, RA);

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
    moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
    return;
  }

  if (a.state==='HUNT'){
    a.rise = Math.min(1, a.rise + dt*2.4);
    a.t -= dt;
    const spd = 3.45 + G.floor*0.34;
    const tgt = a.target || {x:p.x,y:p.y};
    const ang = Math.atan2(tgt.y-a.y, tgt.x-a.x);
    a.face = ang;
    const [dx,dy] = moveEnt(a, Math.cos(ang)*spd*dt, Math.sin(ang)*spd*dt, RA);
    if (Math.hypot(dx,dy)<0.001){
      // blocked — sidestep along the wall
      moveEnt(a, Math.cos(ang+1.57)*spd*dt, Math.sin(ang+1.57)*spd*dt, RA);
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
    moveEnt(a, Math.cos(ang)*2.3*dt, Math.sin(ang)*2.3*dt, RA);
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
/* ---- camera ----
     ONE mapping, used everywhere:
        device_px = SCALE * (world_tiles*TILE + tx)
     so the player's own tile always lands at the centre of the viewport, and
     the light bake (which shares that origin) lines up with the geometry.
     The previous version mixed a pre-scaled offset with a device-space one and
     carried SCALE twice, which panned the world the wrong way and threw the
     player off-screen. */
  const cam = {x:0, y:0, jx:0, jy:0};

  function render(t){
    if (!G) return;
    const p=G.player;

    // camera follow + breathing jitter.
    // Exponential smoothing with a TIME CONSTANT, not a fixed per-frame
    // fraction: 0.12/frame is twice as fast at 144fps as at 72fps, which
    // makes the camera lag inconsistently across machines.
    const dt   = Math.max(0.001, Math.min(0.1, (t - (render.prevT || t-16))/1000));
    render.prevT = t;
    const k    = 1 - Math.exp(-dt/0.09);
    cam.x += (p.x - cam.x) * k;
    cam.y += (p.y - cam.y) * k;
    const breathe = Math.sin(t*0.0009)*0.06;
    cam.jx = (Math.random()-0.5)*0.10 + breathe*0.35;
    cam.jy = (Math.random()-0.5)*0.10;

    // clamp to the maze so the viewport is never half off-map void
    const T = TILE*SCALE;
    const halfW = cvs.width /(2*T), halfH = cvs.height/(2*T);
    if (MAP_W > halfW*2) cam.x = Math.max(halfW, Math.min(MAP_W-halfW, cam.x));
    if (MAP_H > halfH*2) cam.y = Math.max(halfH, Math.min(MAP_H-halfH, cam.y));

    // translate applied inside the scaled context, in world pixels
    const tx = -cam.x*TILE + cvs.width /(2*SCALE) + cam.jx;
    const ty = -cam.y*TILE + cvs.height/(2*SCALE) + cam.jy;
    // same mapping, expressed in device pixels
    const dx = tx*SCALE, dy = ty*SCALE;
    const w2sx = wx => SCALE*(wx*TILE + tx);
    const w2sy = wy => SCALE*(wy*TILE + ty);

    // clean slate. Without this, anything the scene does not paint (the
    // off-map margin at the maze edges) keeps last frame's pixels and the
    // post-processors compound on top of it.
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,cvs.width,cvs.height);

    ctx.setTransform(SCALE,0,0,SCALE,0,0);
    ctx.save();
    ctx.translate(tx, ty);

    const tlx = Math.floor(cam.x - cvs.width /(2*T)) - 1;
    const tly = Math.floor(cam.y - cvs.height/(2*T)) - 1;
    const tw  = Math.ceil(cvs.width /T) + 3;
    const th  = Math.ceil(cvs.height/T) + 3;

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

  /* ---------- 2. wall faces + contact shadow ---------- */
  // The face is the vertical side of a partition, drawn into the floor tile
  // below it. A soft shadow on the carpet under it sells the height, which is
  // what makes a top-down maze read as a photographed room instead of a
  // colour-coded grid.
  const FACE = TILE*0.46;
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
    if (G.grid[y*MAP_W+x]!==WALL) continue;
    if (y+1>=MAP_H || G.grid[(y+1)*MAP_W+x]!==FLOOR) continue;
    const fx=x*TILE, fy=(y+1)*TILE;

    // shadow cast onto the carpet
    const sh=ctx.createLinearGradient(0, fy, 0, fy+TILE*0.5);
    sh.addColorStop(0,'rgba(12,10,4,0.30)');
    sh.addColorStop(1,'rgba(12,10,4,0)');
    ctx.fillStyle=sh;
    ctx.fillRect(fx, fy, TILE, TILE*0.5);

    // wallpapered face
    ctx.fillStyle = wallPat;
    ctx.fillRect(fx, fy, TILE, FACE);
    // hard line where the face meets the ceiling
    ctx.fillStyle='rgba(18,15,6,0.55)';
    ctx.fillRect(fx, fy, TILE, 2);
    // skirting shadow at the base
    ctx.fillStyle='rgba(26,22,9,0.42)';
    ctx.fillRect(fx, fy+FACE-2, TILE, 2);
  }

  /* ---------- 3. wall tops ---------- */
  // Seen from directly above, so they read as the top of a partition: cooler
  // and clearly darker than the carpet. Deliberately NO per-tile banding —
  // a lip/edge/seam on every tile made a solid wall block look like decking.
  // Edges are drawn only where wall actually meets carpet.
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
    if (G.grid[y*MAP_W+x]!==WALL) continue;
    ctx.fillStyle = ceilPat;
    ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
  }
  ctx.fillStyle='rgba(10,8,3,0.55)';
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
    if (G.grid[y*MAP_W+x]!==WALL) continue;
    const below = (y+1<MAP_H && G.grid[(y+1)*MAP_W+x]===FLOOR);
    if (below){ ctx.fillRect(x*TILE, y*TILE+TILE-2, TILE, 2); }
    if (x>0      && G.grid[y*MAP_W+x-1]===FLOOR) ctx.fillRect(x*TILE, y*TILE, 2, TILE);
    if (x<MAP_W-1 && G.grid[y*MAP_W+x+1]===FLOOR) ctx.fillRect(x*TILE+TILE-2, y*TILE, 2, TILE);
    if (y>0      && G.grid[(y-1)*MAP_W+x]===FLOOR) ctx.fillRect(x*TILE, y*TILE, TILE, 2);
    if (y<MAP_H-1 && G.grid[(y+1)*MAP_W+x]===FLOOR) ctx.fillRect(x*TILE, y*TILE+TILE-2, TILE, 2);
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
  ctx.drawImage(lightCv, dx, dy, MAP_W*TILE*SCALE, MAP_H*TILE*SCALE);

  // flickering fluorescents (additive, above the bake)
  ctx.globalCompositeOperation='lighter';
  for (const f of G.fixtures){
    let a = 0.12;
    if (f.flicker){
      a *= (0.35 + 0.65*Math.max(0, Math.sin(t*0.001*f.flicker + f.phase)));
      if (Math.random()<0.02) a*=0.15;
    }
    const fx=w2sx(f.x), fy=w2sy(f.y);
    const rr=f.r*T;
    if (fx<-rr||fy<-rr||fx>cvs.width+rr||fy>cvs.height+rr) continue;
    const gr=ctx.createRadialGradient(fx,fy,0,fx,fy,rr);
    gr.addColorStop(0,`rgba(255,248,196,${a})`);
    gr.addColorStop(0.5,`rgba(226,214,150,${a*0.4})`);
    gr.addColorStop(1,'rgba(180,170,110,0)');
    ctx.fillStyle=gr;
    ctx.fillRect(fx-rr,fy-rr,rr*2,rr*2);
    /* The tube itself must be a FIXED physical size. It used to scale with
       f.r (the 10-19 tile light radius), painting a 130-400px additive slab
       per fixture; two or three overlapping blew the whole frame to white. */
    const tw2 = 2.4*T, th2 = 0.34*T;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(f.phase);
    ctx.fillStyle=`rgba(255,250,214,${0.10 + a*0.5})`;
    ctx.fillRect(-tw2/2, -th2/2, tw2, th2);
    ctx.fillStyle='rgba(255,252,226,0.10)';
    ctx.fillRect(-tw2/2, -th2/2, tw2, th2*0.45);
    ctx.restore();
  }

  // torch — INFORMATION ONLY. it does not repel anything.
  if (G.torch){
    /* The beam starts at the torch, which is held out in FRONT of the figure.
       It used to be anchored at (p.x,p.y) — the tile's top-left corner — while
       the avatar was drawn at the tile centre, so the light appeared to come
       from the top-left of the body rather than out of the torch. */
    const thx = p.x + Math.cos(p.face)*TORCH_OFF;
    const thy = p.y + Math.sin(p.face)*TORCH_OFF;
    const px2=w2sx(thx), py2=w2sy(thy);
    const rad=7.6*T;
    ctx.save();
    ctx.translate(px2,py2);
    ctx.rotate(p.face);
    const cone = ctx.createRadialGradient(0,0,6,0,0,rad);
    cone.addColorStop(0,'rgba(255,250,214,0.26)');
    cone.addColorStop(0.42,'rgba(238,230,180,0.15)');
    cone.addColorStop(1,'rgba(210,200,150,0)');
    ctx.fillStyle=cone;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,rad,-1.05,1.05);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // close spill so you never stand in pitch dark
    const sp=ctx.createRadialGradient(px2,py2,0,px2,py2,rad*0.34);
    sp.addColorStop(0,'rgba(232,224,176,0.09)');
    sp.addColorStop(1,'rgba(232,224,176,0)');
    ctx.fillStyle=sp;
    ctx.fillRect(px2-rad*0.34,py2-rad*0.34,rad*0.68,rad*0.68);
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
  vg2.addColorStop(1,'rgba(0,0,0,0.52)');
  ctx.fillStyle=vg2; ctx.fillRect(0,0,cvs.width,cvs.height);

  /* ---------- 8. VHS composite ---------- */
  /* The chromatic ghost used to do drawImage(cvs, ...) — the canvas ONTO
     ITSELF — with 'lighter'. That feeds back: each frame's source already
     contained the previous frame's ghost, so brightness compounded until the
     whole image desaturated to flat white. Snapshot first, then composite
     the ghost from the snapshot, and clear at the top of the frame. */
  if (!postCv || postCv.width!==cvs.width || postCv.height!==cvs.height){
    postCv = document.createElement('canvas');
    postCv.width = cvs.width; postCv.height = cvs.height;
  }
  const pg = postCv.getContext('2d');
  pg.globalCompositeOperation='copy';
  pg.drawImage(cvs,0,0);
  pg.globalCompositeOperation='source-over';

  // tracking band
  const bandY = ((t*0.055) % (cvs.height+220)) - 110;
  const tg=ctx.createLinearGradient(0,bandY,0,bandY+110);
  tg.addColorStop(0,'rgba(255,255,255,0)');
  tg.addColorStop(0.5,'rgba(255,248,220,0.05)');
  tg.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=tg; ctx.fillRect(0,bandY,cvs.width,110);

  // scanlines
  ctx.globalCompositeOperation='multiply';
  ctx.fillStyle=scanPat;
  ctx.fillRect(0,0,cvs.width,cvs.height);
  ctx.globalCompositeOperation='source-over';

  // grain
  ctx.globalCompositeOperation='overlay';
  ctx.globalAlpha=0.032;
  const gx=-(Math.random()*160)|0, gy=-(Math.random()*160)|0;
  for(let y=gy;y<cvs.height;y+=160) for(let x=gx;x<cvs.width;x+=160) ctx.drawImage(grainCv,x,y);
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';

  // chromatic ghost, from the snapshot — bounded, no feedback
  ctx.globalCompositeOperation='lighter';
  ctx.globalAlpha=0.03;
  const ca = 1 + Math.round(Math.random()*2);
  ctx.drawImage(postCv, -ca, 0);
  ctx.drawImage(postCv,  ca, 0);
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';

  // dropouts
  if (Math.random()<0.02){
    const y=(Math.random()*cvs.height)|0;
    ctx.fillStyle='rgba(210,206,190,0.14)';
    ctx.fillRect(0,y,cvs.width,1+Math.random()*2|0);
  }
}

/* The avatar, seen from directly above.
   Every part of it is drawn INSIDE the collision disc (R = 0.33 tiles).
   The old art used a body ellipse TILE*0.34 tall — already wider than the
   collision radius — so the figure visually clipped into walls it was
   colliding with perfectly well, which read as a collision bug. */
function drawPlayer(p, t){
  const x=p.x*TILE, y=p.y*TILE;

  // contact shadow, kept tight so it never spills onto a wall
  ctx.fillStyle='rgba(8,6,3,0.34)';
  ctx.beginPath(); ctx.ellipse(x+1.5, y+3, TILE*0.19, TILE*0.11, 0,0,6.283); ctx.fill();

  ctx.save();
  ctx.translate(x,y);
  // local -y is forward, so the figure turns to face p.face
  ctx.rotate(p.face + Math.PI/2);

  // torso / shoulders: a slab across the body, seen from above
  ctx.fillStyle='#14120e';
  ctx.beginPath(); ctx.ellipse(0, TILE*0.024, TILE*0.172, TILE*0.136, 0,0,6.283); ctx.fill();
  ctx.fillStyle='#2a2619';
  ctx.beginPath(); ctx.ellipse(0, TILE*0.014, TILE*0.147, TILE*0.111, 0,0,6.283); ctx.fill();

  // arms, either side of the shoulders
  ctx.fillStyle='#1b1913';
  for (const sgn of [-1,1]){
    ctx.beginPath();
    ctx.ellipse(sgn*TILE*0.156, TILE*0.057, TILE*0.054, TILE*0.071, 0,0,6.283);
    ctx.fill();
  }

  // head
  ctx.fillStyle='#ab9d73';
  ctx.beginPath(); ctx.arc(0, -TILE*0.017, TILE*0.095, 0, 6.283); ctx.fill();
  ctx.fillStyle='rgba(16,13,6,0.42)';   // back of the head, away from the light
  ctx.beginPath(); ctx.arc(0, -TILE*0.017+TILE*0.024, TILE*0.095, 0.25, 2.89); ctx.fill();

  // the torch, held out in front — the beam originates exactly here
  const tg = G.torch ? 1 : 0.4;
  ctx.fillStyle=`rgba(255,250,222,${0.55*tg})`;
  ctx.beginPath(); ctx.arc(0, -TORCH_OFF*TILE, TILE*0.047, 0, 6.283); ctx.fill();
  ctx.fillStyle=`rgba(255,244,196,${0.22*tg})`;
  ctx.beginPath(); ctx.arc(0, -TORCH_OFF*TILE, TILE*0.085, 0, 6.283); ctx.fill();

  ctx.restore();
}

function drawAgent(a, t){
  const x=a.x*TILE, y=a.y*TILE;
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
  if (STATE==='play'){
    STATE='pause';
    show('pause');
    // show where you stand, so pausing never costs you your bearings
    const left = G.exitTiles.filter(e=>!e.found).length;
    const h = document.getElementById('pause-hint');
    if (h) h.innerHTML =
      `Depth <b>${G.floor+1}/${FLOORS}</b> &nbsp; Exits <b>${G.exitsFound}/${G.exitTiles.length}</b>`+
      (left ? ` &mdash; <b>${left}</b> still to find` : ' &mdash; go to one')+
      ` &nbsp; Battery <b>${Math.ceil(G.batt)}</b> &nbsp; Lives <b>${lives}</b><br>`+
      `It has heard you make <b>${G.stat.noises}</b> noise${G.stat.noises===1?'':'s'} so far.`;
  }
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