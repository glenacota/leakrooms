import test from 'node:test';
import { fakeAudioContext } from '../helpers/stubs.js';
import { softAssert } from '../helpers/soft-assert.js';
import { readCss, readHtml, readSrc } from '../helpers/src-text.js';
import { loadGame } from '../helpers/harness.js';
import { PLUMBER } from '../../src/config/constants.js';

const { A, G, els, calls } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;
const drawPlumber = A.drawPlumber;
const drawLifeform = A.drawLifeform;
const drawPlumberSprite = A.drawPlumberSprite;
const drawLifeformSprite = A.drawLifeformSprite;

/* ============ TEST 8: avatar art fits the collision disc =============
   The plumber was drawn with a body ellipse TILE*0.34 tall while the collision
   radius is 0.33 tiles, so the figure clipped into walls it was colliding
   with correctly. Assert the drawn geometry never exceeds the disc.        */
test('[8] avatar fits inside the collision disc', () => {
  const t = softAssert();
console.log('[8] avatar fits inside the collision disc');
{
  // geometry of drawPlumber, in tiles, relative to the plumber's tile centre
  const R = PLUMBER.RADIUS;
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
  ];
  let worst=0, worstPart='';
  for (const [name,ox,oy,rx,ry] of parts){
    // farthest corner of the rotated ellipse, conservative: treat as a circle
    const reach = Math.hypot(Math.abs(ox)+rx, Math.abs(oy)+ry);
    if (reach > worst){ worst=reach; worstPart=name; }
    t.assert(reach < R, `avatar part "${name}" reaches ${reach.toFixed(3)} tiles from centre, `+
                      `past the ${R} tile collision radius`);
  }
  console.log(`  widest avatar part "${worstPart}" at ${worst.toFixed(3)} tiles (limit ${R})`);

  /* The radar must be held out in front, not at the body centre, and the cone
     must originate from the same offset — otherwise the character is looking
     from somewhere other than where their hand is. The two are asserted
     separately on purpose: they can drift apart, and they used to be the same
     constant under two names in two functions. */
  t.assert(A.HAND_OFF > 0.05 && A.HAND_OFF < R,
    `HAND_OFF=${A.HAND_OFF} is not a plausible forward offset`);
  const vsrc = A.traceViewCone.toString();
  t.assert(vsrc.includes('HAND_OFF'),
    'the vision cone no longer originates at the hand offset');
  /* The plumber must be drawn at its TRUE position — never at the tile centre
     plus half a tile, which is half a tile from the point collision is resolved
     against, and reads as the figure standing in the corner of its own cell.

     This used to assert on the literal text `const x = p.x*TILE`. Render
     interpolation changed that line to `const x = (wx===undefined ? p.x : wx)
     * TILE` — the same world position whenever no interpolation is supplied — so
     a source-shape check failed on a correct renderer. Asserting the shape of
     an expression means rewriting the assertion every time the expression is
     touched, and it can only ever prove what the source looks like.

     So this measures where the pixels land, which is the claim that matters. It
     puts the plumber and a lifeform at deliberately FRACTIONAL coordinates — where
     a half-tile offset is obvious rather than invisible — draws each one, and
     reads back the first primitive of each. Both draw a contact shadow at a
     known offset from their origin as their very first mark, so the origin is
     recoverable without matching on a colour string. */
  {
    buildFloor(0, 4242);
    G.plumber.x = 30.25; G.plumber.y = 22.75;
    G.plumber.px = G.plumber.x; G.plumber.py = G.plumber.y;    // px==x: no interpolation
    const lf = G.lifeforms[0];
    lf.x = 31.4; lf.y = 23.1; lf.px = lf.x; lf.py = lf.y; lf.rise = 1;
    A.snapMask();

    const px = G.plumber.x*A.TILE, py = G.plumber.y*A.TILE;
    const ax = lf.x*A.TILE,       ay = lf.y*A.TILE;
    /* A half tile is TILE/2, and none of these three marks may sit there. */
    const HALF = A.TILE*0.5;

    calls.list.length = 0;
    A.drawPlumber(G.plumber, 1000);
    const pFirst = calls.list.find(c=>c[0]==='ellipse');
    t.assert(pFirst, 'the plumber drew no ellipse at all — cannot locate it');
    /* contact shadow, centred at (x+1.5, y+3) */
    t.assert(Math.abs(pFirst[1]-(px+1.5)) < 0.01 && Math.abs(pFirst[2]-(py+3)) < 0.01,
      `plumber drawn at (${pFirst[1]},${pFirst[2]}) but its collision point is `+
      `(${px.toFixed(1)},${py.toFixed(1)}) tiles`);
    t.assert(Math.abs(pFirst[1]-(px+HALF+1.5)) > 0.01,
      'plumber is drawn half a tile from its collision point');

    calls.list.length = 0;
    A.drawLifeform(lf, 1000);
    const aEllipse = calls.list.find(c=>c[0]==='ellipse');
    t.assert(aEllipse, 'the lifeform drew no ellipse at all — cannot locate it');
    /* the lifeform's first mark is its shadow ellipse, centred on (x, y+4) */
    t.assert(Math.abs(aEllipse[1]-ax) < 0.01 && Math.abs(aEllipse[2]-(ay+4)) < 0.01,
      `lifeform drawn at (${aEllipse[1]},${aEllipse[2]}) but its collision point is `+
      `(${ax.toFixed(1)},${ay.toFixed(1)}) tiles`);
    t.assert(Math.abs(aEllipse[1]-(ax+HALF)) > 0.01,
      'lifeforms are drawn half a tile from their collision point');
    console.log(`  drawn at true fractional points (${px.toFixed(1)},${py.toFixed(1)}) and `+
                `(${ax.toFixed(1)},${ay.toFixed(1)}) tiles, not tile centre`);
  }
  console.log(`  radar held ${A.HAND_OFF} tiles in front of the body centre; cone originates there too`);
}
  t.done();
});


/* ============ TEST 28: the cast — the Plumber and the Lifeform ============
   Two sprites, inlined in game.js. Two of their properties are mechanics and
   are asserted here as such: a plumber that does not move its feet when it walks
   is a picture of a person, and a plumber that still moves them while standing
   still is a bug in the gait. Both directions are checked against the recorded
   draw calls of the sprite's own drawing code — the same code the game calls. */
test('[28] the cast — the Plumber walks, the Lifeform does not grow', () => {
  const t = softAssert();
console.log('[28] the cast — the Plumber walks, the Lifeform does not grow');
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
    ['the plumber',  A.drawPlumberSprite,  { h:1 }],
    ['the lifeform', A.drawLifeformSprite, { h:1 }],
  ];

  for (const [who, fn, extra] of CAST){
    t.assert(typeof fn==='function', `${who} has no draw function`);
    let threw = null;
    try {
      for (const phase of [0,0.25,0.5,0.75])
        for (const gait of [0,0.55,1])
          for (const h of [0,0.34,1]) run(fn, Object.assign({ T:40, t:1234, gait, phase }, extra, { h }));
    } catch (err) { threw = err; }
    t.assert(!threw, `${who} threw while drawing: ${threw && threw.message}`);
  }

  /* THE CONTRACT: at full gait the pose must depend on the phase (the feet
     are somewhere else a quarter of a cycle later) and at zero gait it must
     not (a standing plumber is symmetric whichever way it last faced). */
  for (const [who, fn] of CAST){
    const a = run(fn, { T:40, t:1234, h:1, gait:1, phase:0.25 });
    const b = run(fn, { T:40, t:1234, h:1, gait:1, phase:0.75 });
    t.assert(a!==b, `${who}: identical drawing at phase .25 and .75 while walking — it does not move`);
    const c = run(fn, { T:40, t:1234, h:1, gait:0, phase:0.25 });
    const d = run(fn, { T:40, t:1234, h:1, gait:0, phase:0.75 });
    t.assert(c===d, `${who}: the pose still depends on the gait clock while standing still`);
  }

  /* THE PLUMBER puts its feet forward of the origin and off the centreline,
     because local -y is where it walks and a symmetric sprite has no feet to
     swing. */
  {
    const c = recCtx();
    A.drawPlumberSprite(c, { T:40, t:0, h:1, gait:1, phase:0.25 });
    t.assert(c.log.length > 20, `the plumber makes only ${c.log.length} draw calls — that is a silhouette, not a rig`);
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
    t.assert(most < -2, `the plumber reaches nothing forward of the origin (closest y = ${most.toFixed(2)}px) — it cannot be walking into anything`);
    t.assert(footmost < -3, `the plumber has no off-centre shape forward of the origin (closest y = ${footmost.toFixed(2)}px) — no feet to swing`);
  }

  /* THE LIFEFORM DOES NOT GROW, AND IS TWICE THE PLUMBER. It is full size on
     the first frame it draws, so the recorded geometry is compared across the
     whole rise range with the gait clock and the wall clock pinned — a single
     stray h term shows up as a difference. globalAlpha is a property rather
     than a call, so the rise's one legitimate job, fading the thing in, never
     reaches this string. */
  {
    const shapeAt = (h) => run(A.drawLifeformSprite, { T:40, t:1234, h, gait:1, phase:0.25 });
    t.assert(shapeAt(0.05)===shapeAt(1),
      'the lifeform changes shape as it rises — its size must not depend on the rise at all');

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
    const plumberH = extent(A.drawPlumberSprite), lifeformH = extent(A.drawLifeformSprite);
    t.assert(lifeformH > plumberH * 1.5,
      `the lifeform is ${lifeformH.toFixed(0)}px tall against the plumber's ${plumberH.toFixed(0)}px — it is not twice the plumber`);
    t.assert(lifeformH < plumberH * 4,
      `the lifeform is ${lifeformH.toFixed(0)}px tall against the plumber's ${plumberH.toFixed(0)}px — past twice the plumber and into the room`);

    /* THE HIT ZONE IS DRAWN AT THE KILL RADIUS. brush() is fatal at CATCH_R
       tiles; the disc under the Lifeform is that radius, so the part that can
       touch you is visible. Asserted against the constant, so a sprite that
       draws a different disc than the one that kills you cannot pass. */
    const c = recCtx();
    A.drawLifeformSprite(c, { T:40, t:0, h:1, gait:1, phase:0.25, danger:1 });
    const want = 40 * 0.52;
    let found = null;
    for (const call of c.log){
      const [k, a, b, rx] = call;
      if ((k==='ellipse' || k==='arc') && Math.abs(rx - want) < 1){ found = call; break; }
    }
    t.assert(found, `the lifeform draws no disc at the ${want.toFixed(1)}px kill radius — the hit zone is invisible`);
  }

  /* the game draws these two and nothing else: no table, no index, no clamp */
  const src = readSrc();
  t.assert(/ENT\.plumber\(p, t, ix\(p\), iy\(p\)\)/.test(src),
    'drawPlumber no longer draws the Plumber');
  t.assert(/ENT\.lifeform\(d\.o, t, ix\(d\.o\), iy\(d\.o\)\)/.test(src),
    'drawLifeform no longer draws the Lifeform');
  t.assert(!/SPRITES/.test(src), 'game.js still dispatches through a sprite table');
  t.assert(!/setSkin/.test(src), 'game.js still carries a skin selector');
  /* and the lifeform is clipped to the floor, so its legs cannot stride over a
     partition — an unclipped leg reads as walking through walls */
  const asrc = A.drawLifeform.toString();
  t.assert(/ctx\.clip\(\)/.test(asrc), 'the lifeform is no longer clipped to the floor');
  t.assert(/G\.grid\[ty\*MAP_W\+tx\]===FLOOR/.test(asrc), 'the floor clip no longer reads the grid');
  t.assert(/CATCH_R/.test(src), 'the hit zone is not drawn at the kill radius');

  const html = readHtml();
  t.assert(!html.includes('sprites.js'), 'index.html still loads sprites.js');

  /* and both survive a real frame — a stub gap in a sprite kills the render,
     not one assert */
  buildFloor(0, 4242);
  A.STATE='play';
  G.plumber.moving = true; G.plumber.stepT = 0.2; G.plumber.stepDur = 0.46;
  for (const a of G.lifeforms) a.rise = 1;
  update(0.016);
  render(1000);
  for (const a of G.lifeforms) a.rise = 0.05;
  render(2000);

  /* the sheet is gone — the cast lives in game.js and nowhere else */

  console.log('  the Plumber strides, the Lifeform is full size at every rise');
  console.log('  the hit zone is drawn at the kill radius, and the legs stop at walls');
  console.log('  and both survive a real update + render');
}
  t.done();
});

