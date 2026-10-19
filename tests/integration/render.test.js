import test from 'node:test';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const { A, G, els, calls } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;

/* Every draw pass has to survive a real frame on a real floor. Rendering is the
   one place a bad coordinate or an unimplemented stub method throws, so this
   drives 400 frames of draw plus update and asserts no exception escapes. */
test('render survives 400 frames of full draw', () => {
  const t = softAssert();
{
  buildFloor(2, 4242);
  let now=Date.now(), err=null;
  try {
    for(let i=0;i<400;i++){ render(now+=16); update(0.016); }
  } catch(e){ err=e; }
  t.assert(!err, 'render threw: '+(err&&err.message));
  console.log(err? '  FAIL' : '  ok — no exceptions');
}
  t.done();
});


/* The camera mixes world and device coordinates, so a mistake here inverts the
   view or applies SCALE twice without throwing anything. This locks the mapping:
   the player centred, a tile to the left on the left, one transform only. */
test('the camera centres the player and keeps the world upright', () => {
  const t = softAssert();
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
  t.assert(SCALE>0, 'no setTransform captured');
  t.assert(tx!==null, 'no translate captured');
  const TW = A.TILE;
  const w2s = (wx,wy)=> [ SCALE*(wx*TW + tx), SCALE*(wy*TW + ty) ];

  const [pxDev, pyDev] = w2s(G.player.x, G.player.y);
  const CW = A.cvs.width, CH = A.cvs.height;
  const tol = TW*SCALE*0.6;
  t.assert(Math.abs(pxDev-CW/2) < tol,
    `player x is ${(pxDev-CW/2).toFixed(0)}px from centre (tol ${tol.toFixed(0)})`);
  t.assert(Math.abs(pyDev-CH/2) < tol,
    `player y is ${(pyDev-CH/2).toFixed(0)}px from centre`);

  // orientation: 5 tiles to the LEFT must be LEFT of centre on screen
  const [lxDev] = w2s(G.player.x-5, G.player.y);
  const [rDev ] = w2s(G.player.x+5, G.player.y);
  const [,uDev] = w2s(G.player.x, G.player.y-5);
  const [,dDev] = w2s(G.player.x, G.player.y+5);
  t.assert(lxDev < pxDev, `X inverted: 5 tiles left landed ${(lxDev-pxDev).toFixed(0)}px from centre`);
  t.assert(rDev > pxDev, 'X inverted (right)');
  t.assert(uDev < pyDev, `Y inverted (up): up=${uDev} vs centre=${pyDev}`);
  t.assert(dDev > pyDev, 'Y inverted (down)');

  // scale must be applied exactly once
  const span = rDev - lxDev;
  t.assert(Math.abs(span - 10*TW*SCALE) < 0.5,
    `10 tiles spans ${span.toFixed(0)}px, expected ${(10*TW*SCALE).toFixed(0)}px — SCALE applied twice?`);

  /* The light bake must share the origin of the geometry.
     This now identifies the lightmap BY IMAGE rather than as "the first
     drawImage in the frame". The flood pass draws its own image inside the
     world transform first, so the ordinal was quietly measuring the wrong
     thing and reporting a spurious failure — the lightmap was aligned the
     whole time. An assertion that depends on draw order is a landmine for
     whoever adds the next image. */
  t.assert(lightDraw, 'lightmap drawImage not captured');
  // drawImage args are [img, x, y, ...] so the origin is at index 2/3
  t.assert(Math.abs(lightDraw[2] - tx*SCALE) < 0.01 && Math.abs(lightDraw[3] - ty*SCALE) < 0.01,
    `lightmap origin (${lightDraw[2]?.toFixed(1)},${lightDraw[3]?.toFixed(1)}) != world origin `+
    `(${(tx*SCALE).toFixed(1)},${(ty*SCALE).toFixed(1)}) — lighting will be offset`);

  /* And the flood image must be drawn INSIDE the world transform, at the map
     origin, so the water sits on the tiles it belongs to. This is the same
     class of error as the leak being filled in device space: correct image,
     wrong coordinate space, nothing looks wrong until you look. */
  t.assert(wetDraw, 'the flood image was never drawn — the water does not render');
  t.assert(wetDraw[2]===0 && wetDraw[3]===0,
    `flood image drawn at (${wetDraw[2]},${wetDraw[3]}) rather than the map origin — water is offset from the tiles it covers`);
  /* Its SIZE is in WORLD units, not device pixels — the draw happens inside the
     scaled transform, exactly like the geometry, so 76 tiles * TILE is correct
     and SCALE is applied by the context on the way out. (The first version of
     this assertion expected the scaled value and failed on a correct
     renderer.) */
  t.assert(wetDraw[4]===76*A.TILE && wetDraw[5]===76*A.TILE,
    `flood image spans ${wetDraw[4]}x${wetDraw[5]} world units, want ${76*A.TILE} — the water is not tile-aligned`);

  console.log(`  player at ${pxDev.toFixed(0)},${pyDev.toFixed(0)}; viewport centre ${CW/2},${CH/2}`);
  console.log(`  10 tiles spans ${span.toFixed(0)}px; lightmap and flood both aligned with geometry`);
}
  t.done();
});


/* A pass that throws is caught elsewhere. What this defends is a pass that
   computes the right numbers in the wrong coordinate space: run after the world
   transform is restored, a world-space fill lands off the canvas and the pipe is
   invisible while every assertion about it still passes. So check the pixels. */
test('the leak is drawn where it is, not just where it is computed', () => {
  const t = softAssert();
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

  t.assert(A.onScreen(L.x+0.5, L.y+0.5),
    'the pipe is not on screen while standing on it — the test cannot check what it cannot see');
  t.assert(A.internals.maskArr[L.y*W+L.x] > 0.9,
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
  t.assert(onCanvas,
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
    t.assert(near.length>0,
      `nothing is drawn within a tile of the pipe at (${lx},${ly}) — `+
      `${calls.list.filter(c=>c[0]==='fillRect').length} fills happened, none of them at the pipe`);
  }

  /* and the progress ring: it must be painted while wrenching, which is the
     only moment-to-moment feedback the repair gives */
  {
    G.player.x=L.sx+0.5; G.player.y=L.sy+0.5;
    for (let i=0;i<120;i++){ G.player.x=L.sx+0.5; G.player.y=L.sy+0.5; update(1/60); }
    t.assert(L.repair>1.5, `only ${L.repair}s of progress after two seconds held`);
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
    t.assert(arcs.length>=2,
      `no ring is painted on the spot while the repair runs `+
      `(repair ${L.repair.toFixed(2)}s, ${arcs.length} arcs at the spot, `+
      `${calls.list.filter(c=>c[0]==='arc').length} arcs drawn in total)`);
    /* two arcs and a stroke: the dark track and the filled portion. One arc
       alone would be the outline of something. */
    t.assert(calls.list.some(c=>c[0]==='stroke'),
      'the ring was traced but never stroked — it is a circle nobody can see');
  }
  console.log('  the pipe and the wrench ring land on screen, not off in device-pixel space');
}
  t.done();
});


/* ============ TEST 29: the canvas state stack survives a frame ============
   The Rigger used to vanish whenever a Lifeform sorted north of it, which is
   most frames in the bottom half of a floor. Cause: drawStalker pushed two
   canvas states and popped one, so drawAgent's two restores popped the wrong
   pair and its FLOOR CLIP stayed live for the rest of the frame — the player,
   drawn after it in the y-sort, was clipped to the five tiles around the
   Stalker. Nothing about the player changed; everything after the agent did.

   Asserted on the real render(), against the real stub context: no save may
   outlive the frame, and no clip may be live while the player is drawn. */
test('[29] canvas state — nothing outlives the frame that opened it', () => {
  const t = softAssert();
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

    t.assert(depth === 0, `render() finished ${depth} canvas state(s) deep — something saved without restoring`);
    t.assert(liveClips() === 0, `${liveClips()} clip(s) survived the frame`);
    t.assert(clipWhenPlayerDrawn === 0,
      `the player was drawn with ${clipWhenPlayerDrawn} clip(s) live — something earlier in the frame never released its clip`);

    /* and it does not accumulate: twenty frames leave the stack where it was */
    for (let i=0;i<20;i++){ update(0.016); render(2000+i*16); }
    t.assert(depth === 0, `after twenty frames the stack is ${depth} deep — the leak compounds`);
  } finally {
    c.save = realSave; c.restore = realRestore; c.clip = realClip;
  }
  console.log('  every save in a frame is popped in that frame');
  console.log('  and nothing is clipped when the player is drawn');
}
  t.done();
});


/* ---- the water shine pays one sine per tile it draws ----
   The shine used to keep each bucket's bounding box and then re-scan that box
   once per bucket, recomputing the phase on the way. Boxes of neighbouring
   buckets overlap whenever the deep water is spread out, so a wide flood paid
   for the same tile up to four times — exactly when the frame budget is
   thinnest. It now collects the tiles once and draws the lists.

   The cost is counted in Math.sin calls, which is the work being paid for: one
   per deep, visible tile. The tiles that count are found by wrapping maskArr,
   which the sheen reads only once a tile is deep enough. */
test('[47] the water shine scales with the tiles it draws, not the buckets', () => {
  const t = softAssert();
console.log('[47] the water shine scales with the tiles it draws, not the buckets');
{
  buildFloor(2, 60606);
  for (let i=0;i<3600;i++) update(1/60);            // let the floor flood
  let now = Date.now();
  for (let i=0;i<60;i++) render(now += 16.7);       // settle the camera

  const realSin = Math.sin, mask = G.maskArr, wet = G.wetArr;
  const frame = ()=>{
    const seen = new Set();
    let calls = 0;
    G.maskArr = new Proxy(mask, { get(a, k){
      if (typeof k === 'string' && /^\d+$/.test(k)) seen.add(+k);
      return a[k];
    }});
    Math.sin = (...a)=>{ calls++; return realSin(...a); };
    try { render(now += 16.7); } finally { Math.sin = realSin; G.maskArr = mask; }
    return { calls, deep: seen.size };
  };

  /* A real flood: deep water sits around the open pipes, in tight pools. */
  const flooded = frame();
  t.assert(flooded.calls <= 1.2*flooded.deep + 200,
    `a flooded view spent ${flooded.calls} sines on ${flooded.deep} deep visible tiles — `+
    'more than one per tile drawn');

  /* The case the boxes made expensive: deep water spread across the whole view,
     in patches, so every bucket's box covers ground the other buckets also
     hold. Deep water really does look like this on a floor that has been
     flooding for a while. */
  for (let i=0;i<wet.length;i++) wet[i] = ((i%76)+((i/76)|0))%2 ? 0 : 0.6+0.4*(i%7)/7;
  for (let i=0;i<mask.length;i++) mask[i] = 1;
  const spread = frame();
  t.assert(spread.calls <= 1.2*spread.deep + 200,
    `a spread-out flood spent ${spread.calls} sines on ${spread.deep} deep visible tiles `+
    `(budget ${Math.round(1.2*spread.deep+200)}) — the shine is scanning tiles it does not draw`);

  console.log(`  flooded ${flooded.calls}/${flooded.deep} sines per deep tile, `+
              `spread ${spread.calls}/${spread.deep} (budget ${Math.round(1.2*spread.deep+200)})`);
}
  t.done();
});

/* ---- the door's body is drawn at full alpha ----
   The lamp glow is a cached sprite whose brightness comes from globalAlpha.
   Forgetting to restore it left the rest of the door — opening, frame, leaf,
   hinges — drawn at the glow's alpha, and the player behind it too, which made
   the door look like glass. A stub canvas neither composites nor restores, so
   the check is on the alpha in force at each fill: the glow and the lamp are
   drawImage, and every fill in the door must be opaque. */
test('[48] the door draws its glow without dimming the rest of the frame', () => {
  const t = softAssert();
console.log('[48] the door draws its glow without dimming the rest of the frame');
{
  buildFloor(0, 24601);
  const door = G.exitTiles[0];
  const c = A.ctxRef;

  /* READY and LOCKED set different glow alphas (0.16 to 0.30 against 0.10), so
     both are worth walking. */
  for (const sealed of [true, false]){
    G.leaksOpen = sealed ? 0 : 1;
    const alphas = [];
    const realFillRect = c.fillRect, realFill = c.fill;
    c.fillRect = (...a)=>{ alphas.push(c.globalAlpha); return realFillRect.apply(c, a); };
    c.fill     = (...a)=>{ alphas.push(c.globalAlpha); return realFill.apply(c, a); };
    calls.list.length = 0;
    try { A.drawDoor(door, 1000); } finally { c.fillRect = realFillRect; c.fill = realFill; }

    const faint = alphas.filter(a => a !== 1);
    t.assert(alphas.length > 0, `${sealed ? 'READY' : 'LOCKED'}: the door drew no fills at all`);
    t.assert(faint.length === 0,
      `${sealed ? 'READY' : 'LOCKED'}: ${faint.length} of ${alphas.length} door fills were drawn at alpha `+
      `${[...new Set(faint)]} — the glow's alpha was never restored`);
    t.assert(calls.list.some(k => k[0] === 'drawImage'),
      `${sealed ? 'READY' : 'LOCKED'}: the glow sprite was not drawn`);
  }
  console.log('  every fill in both door states is drawn at alpha 1');
}
  t.done();
});
