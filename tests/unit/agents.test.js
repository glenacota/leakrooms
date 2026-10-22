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
