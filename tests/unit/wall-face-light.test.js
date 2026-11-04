import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';

const { A, G } = await loadGame();
A.setHeadless(true, true);

const W = 76;

/* Every floor tile with two clear floor tiles to its north, then a wall face,
   then solid wall behind it, so the player can look straight at a face. The face
   must be part of a straight run of three, so a wall end or a doorway beside it
   (which legitimately feathers) does not count. */
function findSpots(){
  const g = (x, y) => G.grid[y*W + x];
  const face = (x, y) => g(x,y)===0 && g(x,y+1)===1;
  const spots = [];
  for (let y=6; y<70; y++) for (let x=4; x<72; x++){
    if (g(x,y)===1 && g(x,y-1)===1 && g(x,y-2)===1 && g(x,y-4)===0
        && face(x-1,y-3) && face(x,y-3) && face(x+1,y-3)) spots.push({ x, y });
  }
  return spots;
}

test('a wall face you look straight at is packed at full brightness', () => {
  const spots = findSpots();
  assert.ok(spots.length > 0, 'no spot with a wall face found');
  let checked = 0;
  for (const s of spots){
    G.plumber.x = s.x + 0.5; G.plumber.y = s.y + 0.5; G.plumber.face = -Math.PI/2;
    G.radar = false;
    A.scopeRoomLight(true);
    A.snapMask();
    A.packMask();

    const px = (x, y) => G.maskImg.data[(y*W + x)*4] / 255;
    const faceY = s.y - 3, behindY = s.y - 4;
    const at = `at ${s.x},${s.y}`;
    const run = [s.x-1, s.x, s.x+1].map(x => A.internals.maskArr[faceY*W + x]);
    // Only judge faces that are fully lit in the mask: a scope fade is not what is under test.
    if (run.some(v => v < 0.999)) continue;
    checked++;
    assert.ok(px(s.x, faceY) > 0.95, `the face is dimmed by the penumbra (${px(s.x, faceY).toFixed(2)}) ${at}`);
    assert.ok(px(s.x, behindY) >= 0.84, `the tile behind the face is too dark (${px(s.x, behindY).toFixed(2)}) ${at}`);
    assert.ok(px(s.x, behindY) <= px(s.x, faceY), `the tile behind the face is brighter than the face ${at}`);
  }
  assert.ok(checked > 0, 'no fully lit face run was found');
});

test('a floor tile behind a thin wall is not lit by the face backlight', () => {
  const g = (x, y) => G.grid[y*W + x];
  let spot = null;
  for (let y=6; y<70 && !spot; y++) for (let x=4; x<72; x++){
    if (g(x,y)===1 && g(x,y-1)===1 && g(x,y-2)===0 && g(x,y-3)===1) { spot = { x, y }; break; }
  }
  if (!spot) return;
  G.plumber.x = spot.x + 0.5; G.plumber.y = spot.y + 0.5; G.plumber.face = -Math.PI/2;
  G.radar = false;
  A.scopeRoomLight(true);
  A.snapMask();
  A.packMask();
  const behind = (spot.y - 3)*W + spot.x;
  assert.equal(G.maskImg.data[behind*4], Math.min(255, A.internals.maskArr[behind]*255));
});
