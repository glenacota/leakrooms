import test from 'node:test';
import { softAssert } from '../helpers/soft-assert.js';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
const update = A.update;
const keys = A.keys;
A.setHeadless(false, false);

/* G.wet must describe the tile the player is standing on after the move, not
   the one left behind. The suite reads wetness through wetAt everywhere else,
   so only this file can tell the two apart. */
test('G.wet describes the tile the player ends the frame on', () => {
  const t = softAssert();
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
  G.plumber.x = bx+0.5; G.plumber.y = by+0.5;
  t.assert(A.wetAt(G.plumber.x, G.plumber.y) === 1, 'the chosen tile is not fully wet');

  /* one real step: a frame is 0.075 tiles of walking, so the player stays
     inside the tile whatever direction it holds */
  keys['d'] = true;
  update(1/60);
  keys['d'] = false;

  t.assert(G.wet === A.wetAt(G.plumber.x, G.plumber.y),
    `G.wet is ${G.wet} but the player now stands on ${A.wetAt(G.plumber.x, G.plumber.y)} — ` +
    'tickMovement sampled the position before the move');
  t.assert(G.wet === 1, `G.wet is ${G.wet} on a fully wet tile`);
  console.log(`  G.wet is the arrival tile: ${G.wet} after one step through water`);
}
  t.done();
});

/* p.moving must be true while a move key is held and false when released.
   Also it must start false on a fresh floor. */
test('p.moving reflects the held key state', () => {
  const t = softAssert();
{
  buildFloor(0, 4242);

  /* At floor start the flag is false. */
  t.assert(G.plumber.moving === false, 'player.moving is false at floor start');

  /* Hold 'd' for 20 frames -> moving true. */
  keys['d'] = true;
  for (let i=0;i<20;i++) update(1/60);
  t.assert(G.plumber.moving === true, 'player.moving is true while a move key is held');

  /* Release and run 2 frames -> moving false. */
  keys['d'] = false;
  update(1/60);
  update(1/60);
  t.assert(G.plumber.moving === false, 'player.moving is false after key release');
}
  t.done();
});
