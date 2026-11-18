import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_HEIGHT_TILES, MAP_WIDTH_TILES, FLOOR, REPAIR_REACH } from '../../src/config/constants.js';
import { LEVELS } from '../../src/config/levels.js';
import { applyEasyFloor, getStaticLevel } from '../../src/game/floor.js';
import { loadGame } from '../helpers/harness.js';

globalThis.location = { search:'?input=touch&easy=false' };
const { A, G, els } = await loadGame();
A.setHeadless(false, false);

test('easy parameter selects compact, seeded, playable floors', () => {
  for (let seed=0; seed<20; seed++){
    for (let floor=0; floor<LEVELS.length; floor++){
      const level = getStaticLevel(seed, floor);
      const { grid, rooms, spawn, exit, leaks, spec, batteries, notes, fixtures } = level;
      assert.equal(rooms.length, 1);
      const room = rooms[0];
      assert.ok(room.rw*room.rh < MAP_WIDTH_TILES*MAP_HEIGHT_TILES/10);
      assert.equal(grid.filter(tile => tile === FLOOR).length, room.rw*room.rh);
      assert.equal(grid[Math.floor(spawn.y)*MAP_WIDTH_TILES+Math.floor(spawn.x)], FLOOR);
      assert.equal(spec.lifeforms, 0);
      assert.equal(leaks.length, LEVELS[floor].leaks);
      assert.equal(exit.length, 1);
      assert.equal(grid[exit[0].y*MAP_WIDTH_TILES+exit[0].x], 0);
      assert.equal(grid[(exit[0].y+1)*MAP_WIDTH_TILES+exit[0].x], FLOOR);
      for (const [i, leak] of leaks.entries()){
        assert.equal(grid[leak.y*MAP_WIDTH_TILES+leak.x], 0);
        assert.equal(grid[leak.sy*MAP_WIDTH_TILES+leak.sx], FLOOR);
        assert.notEqual(leak.x, exit[0].x);
        for (const other of leaks.slice(i+1))
          assert.ok(Math.hypot(leak.sx-other.sx, leak.sy-other.sy) > 2*REPAIR_REACH);
      }
      assert.ok(fixtures.length && batteries.length && notes.length);
      const pickups = [...batteries, ...notes];
      assert.equal(new Set(pickups.map(p => `${p.x},${p.y}`)).size, pickups.length);
      for (const p of pickups)
        assert.equal(grid[Math.floor(p.y)*MAP_WIDTH_TILES+Math.floor(p.x)], FLOOR);
      assert.strictEqual(getStaticLevel(seed, floor), level);
      A.buildFloor(floor, seed);
      const snapshot = JSON.stringify([G.leaks, G.exitTiles, G.batteries, G.notes]);
      G.leaks[0].fixed = true;
      G.batteries[0].taken = true;
      A.buildFloor(floor, seed);
      assert.equal(JSON.stringify([G.leaks, G.exitTiles, G.batteries, G.notes]), snapshot);
      assert.equal(G.lifeforms.length, 0);
    }
  }
});

test('parameter is fixed at boot and normal floor cache remains separate', () => {
  globalThis.location.search = '';
  A.buildFloor(0, 1234);
  assert.equal(G.lifeforms.length, 0);
  const easy = getStaticLevel(1234, 0);
  applyEasyFloor(false);
  const normal = getStaticLevel(1234, 0);
  assert.notStrictEqual(normal, easy);
  assert.ok(normal.rooms.length > 1);
  A.buildFloor(0, 1234);
  assert.equal(G.lifeforms.length, LEVELS[0].lifeforms);
  applyEasyFloor(true);
  assert.equal(getStaticLevel(1234, 0).spec.lifeforms, 0);
});

test('easy run seals every leak and reaches win through real door cycles', () => {
  A.startRun();
  for (let floor=0; floor<LEVELS.length; floor++){
    assert.equal(A.floorIdx, floor);
    assert.equal(G.lifeforms.length, 0);
    for (const leak of G.leaks){
      G.plumber.x = leak.sx+0.5;
      G.plumber.y = leak.sy+0.5;
      const before = G.openLeaks;
      for (let frame=0; frame<600 && !leak.fixed; frame++) A.updateReal(1/60);
      assert.ok(leak.fixed);
      assert.equal(G.openLeaks, before-1);
    }
    const door = G.exitTiles[0];
    G.plumber.x = door.x+0.5;
    G.plumber.y = door.y+1.5;
    for (let frame=0; frame<600 && A.floorIdx===floor; frame++) A.updateReal(1/60);
    assert.equal(A.floorIdx, floor+1);
    if (floor < LEVELS.length-1){
      assert.equal(A.STATE, 'clear');
      assert.equal(A.clearCard.lifeforms, 0);
      assert.equal(els['clear-forms'].textContent, 0);
      assert.equal(A.clearCard.leaks, LEVELS[floor+1].leaks);
      A.dismissClear();
    }
  }
  assert.equal(A.STATE, 'win');
  assert.match(els['win-stats'].innerHTML, /You sealed <b>14<\/b> leaks/);
});
