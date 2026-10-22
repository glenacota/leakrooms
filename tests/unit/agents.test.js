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
{
  /* Level 5, deliberately: it is the level with both a dormant coil and a
     woken hunter in it, and level 1 has exactly one thing in the building. */
  buildFloor(A.LEVELS_N-1, 999);
  let bad=0, hunted=0, dormant=0;
  for (let i=0;i<3000;i++){
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
  t.assert(bad===0, `${bad} entity integrity violations`);
  t.assert(hunted>0, 'entity never entered HUNT state');
  console.log(`  ok — ${hunted} hunting-frames, ${dormant} dormant-frames, no geometry escapes`);
}
  t.done();
});

/* A wandering lifeform touches you if it reaches you.
   Dark corridor: a WALK state lifeform walking through a motionless player
   in darkness must start hunting and emit IT TOUCHED YOU.
   Lit variant: a WALK state lifeform in light must still catch as before. */
test('a wandering lifeform touches you if it reaches you', () => {
  const t = softAssert();
{
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
  const agent = G.agents[0];
  agent.x = xStart + 1.5;
  agent.y = midY;
  agent.state = 'WALK';
  agent.born = 0;
  agent.rise = 1;
  agent.t = 10; // long target timer
  agent.target = { x: midX, y: midY }; // walk toward player

  G.player.x = midX;
  G.player.y = midY;
  G.player.px = midX;
  G.player.py = midY;

  /* Zero light and vis at player position so LOS check fails. */
  const pi = Math.floor(G.player.y)*W + Math.floor(G.player.x);
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

  const agent2 = G.agents[0];
  agent2.x = xStart + 1.5;
  agent2.y = midY;
  agent2.state = 'WALK';
  agent2.born = 0;
  agent2.rise = 1;
  agent2.t = 10;
  agent2.target = { x: midX, y: midY };

  G.player.x = midX;
  G.player.y = midY;
  G.player.px = midX;
  G.player.py = midY;

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
  console.log(`  lit corridor: walker touched player at frame ${touchedLit && huntedLit ? 'OK' : 'FAIL'}`);
}
  t.done();
});
