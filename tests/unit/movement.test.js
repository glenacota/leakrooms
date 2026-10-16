import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const keys = A.keys;
A.setHeadless(false, false);

/* ============ TEST 31: the update stages — G.wet is the tile you end on ===
   update() is now named stages in a fixed order. The one order fact that can
   be asserted from outside is tickMovement's return: G.wet must describe the
   tile the player is standing on AFTER the move. Sampled before the move it
   would describe the tile left behind, and no other test in the suite can
   tell the difference. */
test('[31] the update stages — G.wet tracks where you ended up', () => {
  const t = softAssert();
console.log('[31] the update stages — G.wet tracks where you ended up');
{
  buildFloor(0, 4242);
  const W = 76;
  /* A deep tile: inside the pre-warmed front, so the value is exactly 1 and a
     frame of flood spread cannot move it under the assertion. */
  let bx=-1, by=-1;
  for (let i=0;i<W*W;i++){
    if (A.internals.wetArr[i] === 1 && G.grid[i]===1){ bx=i%W; by=(i/W)|0; break; }
  }
  t.assert(bx>=0, 'no fully wet tile to stand on');
  G.player.x = bx+0.5; G.player.y = by+0.5;
  t.assert(A.wetAt(G.player.x, G.player.y) === 1, 'the chosen tile is not fully wet');

  /* one real step: a frame is 0.075 tiles of walking, so the player stays
     inside the tile whatever direction it holds */
  keys['d'] = true;
  update(1/60);
  keys['d'] = false;

  t.assert(G.wet === A.wetAt(G.player.x, G.player.y),
    `G.wet is ${G.wet} but the player now stands on ${A.wetAt(G.player.x, G.player.y)} — ` +
    'tickMovement sampled the position before the move');
  t.assert(G.wet === 1, `G.wet is ${G.wet} on a fully wet tile`);
  console.log(`  G.wet is the arrival tile: ${G.wet} after one step through water`);
}
  t.done();
});
