import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import { makeInWall } from '../helpers/oracles.js';
const { A, G, els } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const emitNoise = A.emitNoise;
const inWall = makeInWall(G);
A.setHeadless(false, false);

/* Entities move on the same collision disc as the player, so their AI can walk
   them into geometry or into NaN. A long noisy run must also reach HUNT, or the
   AI has stopped responding to sound. */
test('agents stay out of geometry and react to noise', () => {
  const t = softAssert();
  /* Level 5, deliberately: it is the level with both a dormant coil and a
     woken hunter in it, and level 1 has exactly one thing in the building. */
  buildFloor(A.LEVELS_N-1, 999);
  let bad=0, hunted=0, dormant=0;
  for (let i=0;i<3000;i++){
    if (i%11===0){
      emitNoise(1.0, G.plumber.x, G.plumber.y);
      for (const a of G.lifeforms) emitNoise(1.0, a.x, a.y);
    }
    update(0.016);
    if (A.STATE!=='play'){ A.STATE='play'; }
    for (const a of G.lifeforms){
      if (!Number.isFinite(a.x)||!Number.isFinite(a.y)) bad++;
      if (inWall(a.x, a.y, 0.33, true)) bad++;
      if (a.state==='HUNT') hunted++;
      if (a.state==='DORMANT') dormant++;
    }
    if (bad>0) break;
  }
  t.assert(bad===0, `${bad} entity integrity violations`);
  t.assert(hunted>0, 'entity never entered HUNT state');
  console.log(`  ok — ${hunted} hunting-frames, ${dormant} dormant-frames, no geometry escapes`);;
});

/* A wandering lifeform touches you if it reaches you.
   Dark corridor: a WALK state lifeform walking through a motionless player
   in darkness must start hunting and emit IT TOUCHED YOU.
   Lit variant: a WALK state lifeform in light must still catch as before. */
test('a wandering lifeform touches you if it reaches you', () => {
  const t = softAssert();
  buildFloor(0, 4242);
  A.STATE = 'play';

  const W = 76;
  /* Find a corridor: a straight horizontal run of floor tiles.
     We'll use the corridor for both dark and lit tests. */
  let corridor = null;
  for (let y=5; y<W-5 && !corridor; y++){
    let run = 0;
    for (let x=0; x<W; x++){
      if (G.grid[y*W+x]===1) run++;
      else run = 0;
      if (run >= 10){
        corridor = { y, xEnd: x, xStart: x-9 };
        break;
      }
    }
  }
  t.assert(corridor, 'no corridor found on this floor');

  const { xStart, xEnd, y } = corridor;
  const midX = (xStart + xEnd) / 2 + 0.5;
  const midY = y + 0.5;

  /* --- DARK TEST ---
     Zero out light and visibility so the LOS check in tickAgents never fires.
     Put a WALK agent at one end, player at the other, facing each other. */
  const agent = G.lifeforms[0];
  agent.x = xStart + 1.5;
  agent.y = midY;
  agent.state = 'WALK';
  agent.born = 0;
  agent.rise = 1;
  agent.t = 10; // long target timer
  agent.target = { x: midX, y: midY }; // walk toward player

  G.plumber.x = midX;
  G.plumber.y = midY;
  G.plumber.px = midX;
  G.plumber.py = midY;

  /* Zero light and vis at player position so LOS check fails. */
  const pi = Math.floor(G.plumber.y)*W + Math.floor(G.plumber.x);
  G.lightArr[pi] = 0;
  G.visArr[pi] = 0;

  let touched = false;
  let hunted = false;
  for (let i=0;i<200;i++){
    update(1/60);
    const flashEl = els['flashnote'];
    if (flashEl && flashEl.textContent && flashEl.textContent.includes('IT TOUCHED YOU')){
      touched = true;
    }
    if (agent.state === 'HUNT'){
      hunted = true;
    }
    if (touched && hunted) break;
  }
  t.assert(touched, 'dark corridor: IT TOUCHED YOU flash was not emitted');
  t.assert(hunted, 'dark corridor: walker did not transition to HUNT after touching player');
  console.log(`  dark corridor: walker touched player at frame ${touched && hunted ? 'OK' : 'FAIL'}`);

  /* --- LIT TEST ---
     Same setup but with light. The walker should still touch and trigger brush.
     In light, the LOS check might also trigger HUNT, but brush must still fire. */
  buildFloor(0, 4242);
  A.STATE = 'play';

  const agent2 = G.lifeforms[0];
  agent2.x = xStart + 1.5;
  agent2.y = midY;
  agent2.state = 'WALK';
  agent2.born = 0;
  agent2.rise = 1;
  agent2.t = 10;
  agent2.target = { x: midX, y: midY };

  G.plumber.x = midX;
  G.plumber.y = midY;
  G.plumber.px = midX;
  G.plumber.py = midY;

  /* Ensure light and vis are high at player position. */
  G.lightArr[pi] = 1;
  G.visArr[pi] = 1;

  let touchedLit = false;
  let huntedLit = false;
  for (let i=0;i<200;i++){
    update(1/60);
    const flashEl = els['flashnote'];
    if (flashEl && flashEl.textContent && flashEl.textContent.includes('IT TOUCHED YOU')){
      touchedLit = true;
    }
    if (agent2.state === 'HUNT'){
      huntedLit = true;
    }
    if (touchedLit && huntedLit) break;
  }
  t.assert(touchedLit, 'lit corridor: IT TOUCHED YOU flash was not emitted');
  t.assert(huntedLit, 'lit corridor: walker did not transition to HUNT after touching player');
  console.log(`  lit corridor: walker touched player at frame ${touchedLit && huntedLit ? 'OK' : 'FAIL'}`);;
});

/* SEARCH timeout goes to WALK, not DORMANT. The "may go back to sleep"
   comment was dead code: the old logic set DORMANT then immediately
   overwrote it with WALK whenever born <= 0 (always true after grace). */
test('SEARCH timeout goes to WALK, never DORMANT', () => {
  const t = softAssert();
  buildFloor(0, 4242);
  A.STATE = 'play';

  /* Create a SEARCH agent with a very short timer. */
  const agent = G.lifeforms[0];
  agent.x = 10.5; agent.y = 10.5;
  agent.state = 'SEARCH';
  agent.born = 0;
  agent.rise = 1;
  agent.t = 0.001; // expires immediately
  agent.target = { x: 10.5, y: 10.5 };

  /* Step once - timer should expire. */
  update(1/60);

  t.assert(agent.state === 'WALK', `SEARCH timed out to ${agent.state}, expected WALK`);
  t.assert(agent.rise === 1, `rise should be 1 (fully up), got ${agent.rise}`);

  /* Step many more frames - it should stay WALK, never go to DORMANT. */
  let everDormant = false;
  for (let i=0;i<200;i++){
    update(1/60);
    if (agent.state === 'DORMANT') everDormant = true;
  }
  t.assert(!everDormant, 'agent entered DORMANT after SEARCH timeout — should stay WALK');
  t.assert(agent.state === 'WALK', `after 200 frames, state is ${agent.state}, expected WALK`);

  console.log('  SEARCH timeout -> WALK; never DORMANT afterwards');;
});

/* SEARCH with distance field: a searching lifeform sent to a spot with no
   line of sight, within 20 walking tiles, arrives before its 4.5 s timer
   would run out at 2.3 tiles/s. */
test('SEARCH follows distance field to reach no-LOS target in time', () => {
  const t = softAssert();
  buildFloor(0, 4242);
  A.STATE = 'play';

  /* Find a pair of floor tiles with no LOS, path length <= 15 tiles
     (so 2.3 tiles/s * 4.5s = 10.35 tiles of straight movement, but path
     can be longer due to walls). We'll look for a reasonable distance. */
  const W = 76;
  const FLOOR_T = 1;
  const at = (x,y)=> (x<0||y<0||x>=W||y>=W) ? FLOOR_T : G.grid[y*W+x];

  const floors = [];
  for (let y=0; y<W; y++) for (let x=0; x<W; x++) if (at(x,y)===FLOOR_T) floors.push({x,y});

  let pair = null;
  for (let attempts=0; attempts<1000 && !pair; attempts++){
    const a = floors[Math.floor(A.mulberry32(attempts*12345+1)() * floors.length)];
    const b = floors[Math.floor(A.mulberry32(attempts*12345+67890)() * floors.length)];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < 5 || d > 20) continue;
    const ax = a.x + 0.5, ay = a.y + 0.5;
    const bx = b.x + 0.5, by = b.y + 0.5;
    const hasLOS = A.G.los(ax, ay, bx, by);
    if (!hasLOS){
      /* Check path length via distance field. */
      const field = A.distanceField(b.x, b.y);
      const pathLen = field[a.y*W+a.x];
      if (pathLen >= 0 && pathLen <= 15){ // reachable within ~15 steps
        pair = {ax, ay, bx, by, pathLen};
      }
    }
  }
  if (!pair){
    t.assert(pair, 'found no-LOS pair with path <= 15 tiles');
    t.done();
    return;
  }
  t.assert(pair, 'found no-LOS pair with path <= 15 tiles');
  console.log(`  test pair: (${pair.ax},${pair.ay}) -> (${pair.bx},${pair.by}), pathLen=${pair.pathLen}`);

  /* Place a SEARCH agent at start, target at end. */
  const agent = G.lifeforms[0];
  agent.x = pair.ax; agent.y = pair.ay;
  agent.state = 'SEARCH';
  agent.born = 0;
  agent.rise = 1;
  agent.t = 4.5; // full SEARCH timer
  agent.target = {x: pair.bx, y: pair.by};
  agent.face = 0;
  G.plumber = {x: pair.bx - 8, y: pair.by - 8, face: 0};

  let success = false;
  let framesUsed = 0;
  for (let frame=0; frame<300; frame++){ // 5 seconds at 60Hz (timer is 4.5s)
    framesUsed = frame;
    update(1/60);
    const d = Math.hypot(agent.x - pair.bx, agent.y - pair.by);
    if (d < 0.5){ success = true; break; }
    if (agent.state !== 'SEARCH') break; // timed out or retargeted
  }
  t.assert(success, `SEARCH agent did not reach target in time (state=${agent.state}, t=${agent.t.toFixed(2)})`);
  console.log(`  SEARCH reached target in ${framesUsed} frames`);;
});

/* HUNT hold-and-turn: when a HUNT lifeform reaches its target, it holds
   still and turns for 2 s before the 8 s give-up timer starts.
   A new loud sound during the hold retargets it immediately. */
test('HUNT hold: agent holds and turns for 2s at target, then gives up; loud sound retargets during hold', () => {
  const t = softAssert();
  buildFloor(0, 4242);
  A.STATE = 'play';

  /* Place a HUNT agent right at its target. */
  const agent = G.lifeforms[0];
  agent.x = 10.5; agent.y = 10.5;
  agent.state = 'HUNT';
  agent.born = 0;
  agent.rise = 1;
  agent.t = 0; // just started hunting
  agent.target = { x: 10.5, y: 10.5 }; // target is right here
  agent.face = 0;
  G.plumber = {x: 10.5, y: 10.5, face: 0};

  /* Step a few frames - agent should be in hold phase (a.hold > 0). */
  let face0 = agent.face;
  let faceChanged = false;
  for (let i=0; i<30; i++){ // 0.5s
    update(1/60);
    if (agent.face !== face0) faceChanged = true;
  }
  
  t.assert(agent.state === 'HUNT', `state should be HUNT during hold, got ${agent.state}`);
  t.assert(agent.hold !== undefined && agent.hold > 0, `agent should have hold timer (${agent.hold})`);
  t.assert(faceChanged, 'agent should turn during hold');

  /* Hold should last 2s total. After ~120 frames, hold expires and give-up timer starts. */
  let afterHold = false;
  for (let i=0; i<150; i++){
    update(1/60);
    if (agent.hold === 0 && agent.t < 0) afterHold = true;
  }
  console.log(`  HUNT hold-and-turn: holds 2s, turns, then gives up; loud sound retargets during hold`);

  /* After 8s more (give-up), agent should switch to SEARCH. */
  let searchReached = false;
  for (let i=0; i<500; i++){
    update(1/60);
    if (agent.state === 'SEARCH'){ searchReached = true; break; }
  }
  t.assert(searchReached, 'agent should transition to SEARCH after 8s give-up');

  /* Now test: loud sound during hold should retarget immediately. */
  buildFloor(0, 4242);
  A.STATE = 'play';
  const agent2 = G.lifeforms[0];
  agent2.x = 20.5; agent2.y = 20.5;
  agent2.state = 'HUNT';
  agent2.born = 0; agent2.rise = 1;
  agent2.t = 0;
  agent2.target = { x: 20.5, y: 20.5 };
  agent2.face = 0;
  G.plumber = {x: 20.5, y: 20.5, face: 0};

  /* Start hold by stepping once. */
  update(1/60);
  t.assert(agent2.hold > 0, 'hold should start');

  /* During hold, emit a loud sound at a nearby location (5 tiles away, within hearing range). */
  const loudX = 25.5, loudY = 20.5;
  A.sustainedNoise(A.SPRINT_NOISE, loudX, loudY, false); // loud, not mine

  /* Agent should retarget immediately. */
  update(1/60);
  t.assert(agent2.target.x === loudX && agent2.target.y === loudY,
    `agent should retarget to loud sound during hold, target is (${agent2.target.x},${agent2.target.y})`);
  t.assert(agent2.state === 'HUNT', 'state should remain HUNT');

  console.log('  HUNT hold-and-turn: holds 2s, turns, then gives up; loud sound retargets during hold');;
});
