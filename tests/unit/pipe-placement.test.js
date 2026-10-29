/* Verifies that every generated leak has its standing spot on the tile directly
   south of the wall tile — i.e. the pipe is always on a south-facing wall face.
   Pure property check across 50 seeds × 5 floors. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/harness.js';
import { FLOOR } from '../../src/config/constants.js';

const { A, G } = await loadGame();
const buildFloor = A.buildFloor;
A.setHeadless(false, false);

test('every leak stands on the tile directly south of its wall tile', () => {
  const grid = ()=> G.grid;
  const at = (x,y)=> grid()[y*76+x];
  let checked = 0;
  for (let s = 0; s < 50; s++){
    buildFloor(s % 5, s*104729 + 17);
    for (const L of G.leaks){
      // The standing spot must be directly south of the wall tile.
      assert.equal(L.sx, L.x,
        `seed ${s}: leak at (${L.x},${L.y}) has sx=${L.sx}, expected ${L.x}`);
      assert.equal(L.sy, L.y + 1,
        `seed ${s}: leak at (${L.x},${L.y}) has sy=${L.sy}, expected ${L.y+1}`);
      // That tile must be FLOOR (not WALL or out-of-bounds).
      assert.equal(at(L.sx, L.sy), FLOOR,
        `seed ${s}: standing spot (${L.sx},${L.sy}) is not FLOOR (got ${at(L.sx,L.sy)})`);
      // The pipe tile itself must be WALL.
      assert.notEqual(at(L.x, L.y), FLOOR,
        `seed ${s}: pipe tile (${L.x},${L.y}) should be WALL but is FLOOR`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'no leaks were generated across 50 seeds');
});
