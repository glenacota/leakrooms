import test from 'node:test';
import assert from 'node:assert/strict';
import { softAssert } from '../helpers/soft-assert.js';
import { paintedReach } from '../helpers/geometry.js';
import { loadGame } from '../helpers/harness.js';
import { CATCH_R, FLOOR, MAP_H, MAP_W, PLUMBER, TILE } from '../../src/config/constants.js';

const { A, G, els, calls } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const render = A.render;

/* Reach of a sprite, in tiles from its origin, measured from what it paints. */
const reachTiles = (S) => paintedReach((g) => A.drawPlumberSprite(g, { T: TILE, ...S })) / TILE;

/* ============ TEST 8: avatar art fits the collision disc =============
   The plumber was drawn with a body ellipse TILE*0.34 tall while the collision
   radius is 0.33 tiles, so the figure clipped into walls it was colliding
   with correctly. The reach is measured from the painted geometry. */
test('[8] avatar fits inside the collision disc', () => {
  const t = softAssert();
console.log('[8] avatar fits inside the collision disc');
{
  const RT = PLUMBER.RADIUS;
  let standing = 0, walking = 0;
  for (const phase of [0, 0.125, 0.25, 0.5, 0.75, 0.875]) {
    standing = Math.max(standing, reachTiles({ gait: 0, phase, wave: 0, t: 1234 }));
    walking  = Math.max(walking,  reachTiles({ gait: 1, phase, wave: 0, t: 1234 }));
  }
  t.assert(standing < RT, `standing plumber reaches ${standing.toFixed(3)} tiles from centre, past the ${RT} tile collision radius`);
  t.assert(walking < RT,  `walking plumber reaches ${walking.toFixed(3)} tiles from centre, past the ${RT} tile collision radius`);
  console.log(`  standing reach ${standing.toFixed(3)}, walking reach ${walking.toFixed(3)} tiles (limit ${RT})`);

  /* The radar is held out in front of the body centre by HAND_OFF, and the
     vision cone starts there too. The cone's origin is checked behaviourally in
     vision.test.js, where the cone is read back from the grid. Here we check
     only that the offset is a plausible forward distance. */
  t.assert(A.HAND_OFF > 0.05 && A.HAND_OFF < RT,
    `HAND_OFF=${A.HAND_OFF} is not a plausible forward offset`);

  /* The plumber must be drawn at its TRUE position, never half a tile off the
     point collision is resolved against. Both sprites open with a contact
     shadow at a known offset, so the origin is recoverable from the first
     ellipse drawn. Fractional coordinates make a half-tile error obvious. */
  {
    buildFloor(0, 4242);
    G.plumber.x = 30.25; G.plumber.y = 22.75;
    G.plumber.px = G.plumber.x; G.plumber.py = G.plumber.y;    // px==x: no interpolation
    const lf = G.lifeforms[0];
    lf.x = 31.4; lf.y = 23.1; lf.px = lf.x; lf.py = lf.y; lf.rise = 1;
    A.snapMask();

    const px = G.plumber.x*A.TILE, py = G.plumber.y*A.TILE;
    const ax = lf.x*A.TILE,       ay = lf.y*A.TILE;
    const HALF = A.TILE*0.5;

    calls.list.length = 0;
    A.drawPlumber(G.plumber, 1000);
    const pFirst = calls.list.find(c=>c[0]==='ellipse');
    t.assert(pFirst, 'the plumber drew no ellipse at all — cannot locate it');
    t.assert(Math.abs(pFirst[1]-(px+1.5)) < 0.01 && Math.abs(pFirst[2]-(py+3)) < 0.01,
      `plumber drawn at (${pFirst[1]},${pFirst[2]}) but its collision point is `+
      `(${px.toFixed(1)},${py.toFixed(1)}) tiles`);
    t.assert(Math.abs(pFirst[1]-(px+HALF+1.5)) > 0.01,
      'plumber is drawn half a tile from its collision point');

    calls.list.length = 0;
    A.drawLifeform(lf, 1000);
    const aEllipse = calls.list.find(c=>c[0]==='ellipse');
    t.assert(aEllipse, 'the lifeform drew no ellipse at all — cannot locate it');
    t.assert(Math.abs(aEllipse[1]-ax) < 0.01 && Math.abs(aEllipse[2]-(ay+4)) < 0.01,
      `lifeform drawn at (${aEllipse[1]},${aEllipse[2]}) but its collision point is `+
      `(${ax.toFixed(1)},${ay.toFixed(1)}) tiles`);
    t.assert(Math.abs(aEllipse[1]-(ax+HALF)) > 0.01,
      'lifeforms are drawn half a tile from their collision point');
    console.log(`  drawn at true fractional points (${px.toFixed(1)},${py.toFixed(1)}) and `+
                `(${ax.toFixed(1)},${ay.toFixed(1)}) tiles, not tile centre`);
  }
}
  t.done();
});

/* The raised wrench is drawn during a repair wave, when the plumber stands still
   at a leak. Its reach is measured across the sway cycle, so the held-up hand
   cannot poke through a wall it is repairing against. */
test('[8b] the raised wrench stays inside the collision disc', () => {
    let worst = 0;
    for (const t of [0, 112, 224, 336, 448])
      worst = Math.max(worst, reachTiles({ gait: 0, phase: 0, wave: 1, t }));
    assert.ok(worst < PLUMBER.RADIUS,
      `raised pose reaches ${worst.toFixed(3)} tiles from centre, past the ${PLUMBER.RADIUS} tile collision radius`);
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
    const want = TILE * CATCH_R;
    /* Both the filled disc and the red ring must sit at the kill radius. Each is
       an ellipse call followed by the paint call that uses it. */
    const atRadius = c.log.map((call, i) => ({ call, paint: (c.log[i+1] || [])[0] }))
      .filter(({ call }) => (call[0]==='ellipse' || call[0]==='arc') && Math.abs(call[3] - want) < 1);
    t.assert(atRadius.some(x=>x.paint==='fill'),
      `the lifeform's filled hit disc is not drawn at the ${want.toFixed(1)}px kill radius — the part that can touch you is not what is shown`);
    t.assert(atRadius.some(x=>x.paint==='stroke'),
      `the lifeform's hit ring is not drawn at the ${want.toFixed(1)}px kill radius`);
  }

  /* THE LEGS STOP AT THE WALL. drawLifeform clips to the floor tiles near it,
     so a leg cannot stride over a partition. Read back from the rectangles it
     actually hands to clip(), not from the words of its source. */
  {
    buildFloor(0, 4242);
    const isFloor = (tx, ty) => tx>=0 && ty>=0 && tx<MAP_W && ty<MAP_H && G.grid[ty*MAP_W+tx]===FLOOR;
    let edge = null;
    for (let ty=1; ty<MAP_H-1 && !edge; ty++)
      for (let tx=1; tx<MAP_W-1 && !edge; tx++)
        if (isFloor(tx, ty) && !isFloor(tx+1, ty)) edge = {tx, ty};
    t.assert(edge, 'the floor has no floor-to-wall edge to test the clip against');
    if (edge){
      const lf = G.lifeforms[0];
      lf.x = edge.tx+0.5; lf.y = edge.ty+0.5; lf.px = lf.x; lf.py = lf.y; lf.rise = 1;
      calls.list.length = 0;
      A.drawLifeform(lf, 1000);
      const clipAt = calls.list.findIndex(c=>c[0]==='clip');
      t.assert(clipAt>=0, 'the lifeform is not clipped to the floor at all');
      const clipped = calls.list.slice(0, Math.max(0, clipAt))
        .filter(c=>c[0]==='rect')
        .map(c=>[Math.round(c[1]/TILE), Math.round(c[2]/TILE)]);
      const onWall = clipped.filter(([x,y])=>!isFloor(x,y));
      t.assert(onWall.length===0, `the clip admits ${onWall.length} wall tile(s), so legs could stride over a partition`);
      const near = [];
      for (let ty=edge.ty-3; ty<=edge.ty+3; ty++)
        for (let tx=edge.tx-3; tx<=edge.tx+3; tx++)
          if (isFloor(tx, ty) && Math.hypot(tx+0.5-lf.x, ty+0.5-lf.y) <= 2) near.push([tx, ty]);
      const missing = near.filter(([x,y])=>!clipped.some(([cx,cy])=>cx===x && cy===y));
      t.assert(missing.length===0, `${missing.length} floor tile(s) within 2 tiles of the lifeform are not in its clip`);
    }
  }

  /* Both sprites are drawn by the game's own draw seam during a real frame.
     Wrapping ENT counts the calls the actors pass makes, so a sprite that is
     built but never placed in the frame fails here, without reading the source. */
  {
    const seen = { plumber: 0, lifeform: 0 };
    const original = { plumber: A.ENT.plumber, lifeform: A.ENT.lifeform };
    A.ENT.plumber  = (...a) => { seen.plumber++;  return original.plumber(...a); };
    A.ENT.lifeform = (...a) => { seen.lifeform++; return original.lifeform(...a); };
    try {
      buildFloor(0, 4242);
      A.STATE='play';
      G.plumber.moving = true; G.plumber.stepT = 0.2; G.plumber.stepDur = 0.46;
      for (const a of G.lifeforms) a.rise = 1;
      update(0.016);
      render(1000);
      for (const a of G.lifeforms) a.rise = 0.05;
      render(2000);
    } finally {
      A.ENT.plumber = original.plumber;
      A.ENT.lifeform = original.lifeform;
    }
    t.assert(seen.plumber === 2, `the frame drew the plumber ${seen.plumber} times through the seam, expected once per render`);
    t.assert(seen.lifeform >= 1, 'no lifeform was drawn through the seam in a real frame');
  }

  console.log('  the Plumber strides, the Lifeform is full size at every rise');
  console.log('  the hit zone is drawn at the kill radius, and the legs stop at walls');
  console.log('  and both survive a real update + render');
}
  t.done();
});
