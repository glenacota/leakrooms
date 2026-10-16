import test from 'node:test';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';

const { A, G, els, calls } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;

/* ============ TEST 5: render does not throw ============ */
test('[5] render — 400 frames of full draw', () => {
  const t = softAssert();
console.log('[5] render — 400 frames of full draw');
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


/* ============ TEST 7: camera mapping ==============================
   The first playable build panned the world the wrong way and threw the
   player off-screen: the camera offset mixed a pre-scaled value with a
   device-space one and carried SCALE twice. Lock the mapping down.        */
test('[7] camera mapping — player centred, world not inverted', () => {
  const t = softAssert();
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
test('[19] the leak is drawn where it is, not just where it is computed', () => {
  const t = softAssert();
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


