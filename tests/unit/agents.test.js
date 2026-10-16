import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';
import { makeInWall } from '../helpers/oracles.js';
const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const emitNoise = A.emitNoise;
const inWall = makeInWall(G);
A.setHeadless(false, false);

/* ============ TEST 3: entities stay on floor, stay finite ============ */
test('[3] entity AI — 20000 frames', () => {
  const t = softAssert();
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
  t.assert(bad===0, `${bad} entity integrity violations`);
  t.assert(hunted>0, 'entity never entered HUNT state');
  console.log(`  ok — ${hunted} hunting-frames, ${dormant} dormant-frames, no geometry escapes`);
}
  t.done();
});
